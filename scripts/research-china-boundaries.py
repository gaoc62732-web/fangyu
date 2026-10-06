"""Cache public boundary evidence without modifying the active map dataset."""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import gzip
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/tmp/china-boundary-review"
sys.stdout.reconfigure(encoding="utf-8")


def fetch(name, url, timeout=50, curl_post=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    destination = CACHE / name
    metadata_file = destination.with_name(destination.name + ".source.json")
    if destination.exists() and metadata_file.exists():
        cached = destination.read_bytes()
        if not (name.endswith(".json") and json.loads(cached).get("remark")):
            return cached
    if curl_post:
        # Native TLS plus POST avoids the connection errors seen with long GET
        # queries. Arguments go directly to the process, never through a shell.
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(parsed.query)['data'][0]
        endpoint = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))
        temporary = destination.with_name(destination.name + '.part')
        result = subprocess.run([
            shutil.which('curl.exe') or shutil.which('curl') or 'curl',
            '--fail', '--silent', '--show-error', '--compressed', '--max-time', str(timeout),
            '--user-agent', 'FangyuBoundaryReview/1.0', '--data-urlencode', 'data=' + query,
            '--output', str(temporary), endpoint,
        ], capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip())
        payload = temporary.read_bytes()
        metadata = {'url': url, 'resolvedUrl': endpoint, 'requestMethod': 'POST'}
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "FangyuBoundaryReview/1.0", "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                payload = gzip.decompress(payload)
            metadata = {'url': url, 'resolvedUrl': response.url}
    metadata.update({
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload),
    })
    if name.endswith(".json"):
        value = json.loads(payload)
        if isinstance(value, dict) and value.get("remark"):
            raise RuntimeError(value["remark"])
    destination.write_bytes(payload)
    metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url")
    parser.add_argument("--name")
    parser.add_argument("--batch", type=Path, help="JSON list of public geographic evidence URLs")
    parser.add_argument("--overpass", type=Path, help="Text file containing a read-only Overpass query")
    parser.add_argument("--overpass-batch", type=Path, help="JSON list of local read-only query filenames")
    parser.add_argument("--endpoint", help="Public read-only Overpass interpreter URL")
    parser.add_argument("--timeout", type=int, default=190, help="Read timeout for Overpass acquisition")
    parser.add_argument("--query-timeout", type=int, help="Override the server-side Overpass query timeout")
    parser.add_argument("--curl", action='store_true', help="Use native curl TLS and POST for Overpass queries")
    parser.add_argument("--search", nargs="+")
    parser.add_argument("--engine", choices=["google", "bing", "ddg", "baidu", "so"], default="google")
    args = parser.parse_args()
    if args.overpass_batch:
        jobs = json.loads(args.overpass_batch.read_text(encoding="utf-8"))
        def run_query(job):
            result = {"name": job["name"]}
            query = (ROOT / job["query"]).read_text(encoding="utf-8")
            if args.query_timeout:
                query = re.sub(r'\[timeout:\d+\]', f'[timeout:{args.query_timeout}]', query)
            for endpoint in ([args.endpoint] if args.endpoint else ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]):
                try:
                    payload = fetch(job["name"], endpoint + "?data=" + urllib.parse.quote(query), timeout=args.timeout, curl_post=args.curl)
                    data = json.loads(payload)
                    if data.get("remark"):
                        raise RuntimeError(data["remark"])
                    result["elements"] = len(data.get("elements", []))
                    result["bytes"] = len(payload)
                    result.pop("error", None)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
                    return
                except Exception as error:
                    result["error"] = str(error)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(run_query, jobs))
    if args.batch:
        jobs = json.loads(args.batch.read_text(encoding="utf-8"))
        def download(job):
            try:
                payload = fetch(job["name"], job["url"])
                info = {"name": job["name"], "bytes": len(payload)}
                if job["name"].endswith(".json"):
                    value = json.loads(payload)
                    info["keys"] = list(value)[:15] if isinstance(value, dict) else "array"
                    if isinstance(value, dict) and "features" in value:
                        info["features"] = [{"type": f.get("geometry", {}).get("type"), "properties": f.get("properties")} for f in value["features"][:40]]
                return info
            except Exception as error:
                return {"name": job["name"], "error": str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for result in pool.map(download, jobs):
                print(json.dumps(result, ensure_ascii=False), flush=True)
    if args.overpass:
        query = args.overpass.read_text(encoding="utf-8")
        if args.query_timeout:
            query = re.sub(r'\[timeout:\d+\]', f'[timeout:{args.query_timeout}]', query)
        last_error = None
        for endpoint in ([args.endpoint] if args.endpoint else ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]):
            try:
                url = endpoint + "?data=" + urllib.parse.quote(query)
                payload = fetch(args.name, url, timeout=args.timeout, curl_post=args.curl)
                result = json.loads(payload)
                if result.get("remark"):
                    raise RuntimeError(result["remark"])
                print(json.dumps({"name": args.name, "elements": len(result.get("elements", [])), "tags": [{"type": e["type"], "id": e["id"], "tags": e.get("tags")} for e in result.get("elements", [])[:30]]}, ensure_ascii=False), flush=True)
                break
            except Exception as error:
                last_error = error
                print(json.dumps({"endpoint": endpoint, "error": str(error)}), flush=True)
        else:
            raise RuntimeError(last_error)
    if args.url:
        if not args.name or Path(args.name).name != args.name:
            parser.error("--name must be a filename within the research cache")
        payload = fetch(args.name, args.url)
        print(json.dumps({"path": str(CACHE / args.name), "bytes": len(payload)}, ensure_ascii=False))
    if args.search:
        endpoints = {"google": "https://www.google.com/search?q=", "bing": "https://cn.bing.com/search?ensearch=0&q=", "ddg": "https://html.duckduckgo.com/html/?q=", "baidu": "https://www.baidu.com/s?wd=", "so": "https://www.so.com/s?q="}
        def search(query):
            name = "search-" + args.engine + "-" + hashlib.sha256(query.encode()).hexdigest()[:12] + ".html"
            try:
                raw = fetch(name, endpoints[args.engine] + urllib.parse.quote_plus(query)).decode("utf-8", errors="replace")
                raw = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw, flags=re.S)
                readable = unescape(re.sub("<[^>]+>", " ", raw))
                readable = re.sub(r"\s+", " ", readable)
                urls = [unescape(u) for u in re.findall(r'href="(https?[^"<>]+)"', raw)]
                return {"query": query, "path": str(CACHE / name), "text": readable[:16000], "urls": urls[:35]}
            except Exception as error:
                return {"query": query, "error": str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for result in pool.map(search, args.search):
                print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
