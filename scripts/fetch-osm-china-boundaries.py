"""Download OSM China administrative relations through Overpass.

This follows the project's earlier DownloadOsm.py pattern: requests.post with a
plain Overpass body, explicit connect/read timeouts, retries, and one cached raw
JSON file per query. Conversion and catalog replacement are intentionally done
offline by scripts/lib/prepare-osm-boundaries.mjs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ModuleNotFoundError:
    requests = None

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "tmp" / "osm-china-python"
LEGACY = ROOT / "data" / "tmp" / "osm-china"
OUTPUT = ROOT / "data" / "boundaries" / "china-osm"
RAW = OUTPUT / "raw"
DEFAULT_ENDPOINTS = [
    "http://overpass-api.de/api/interpreter",
    "http://z.overpass-api.de/api/interpreter",
]
USER_AGENT = "FangyuBoundaryImporter/2.0 (OSM administrative boundary snapshot)"
RETRIES = 5


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def archive_raw_response(name: str, payload: bytes, response: dict, query: str | None = None,
                         overwrite: bool = False) -> bool:
    if Path(name).name != name or not isinstance(response.get("elements"), list):
        return False
    RAW.mkdir(parents=True, exist_ok=True)
    target = RAW / name
    metadata = target.with_suffix(".meta.json")
    written = False
    if overwrite or not target.exists():
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_bytes(payload)
        temporary.replace(target)
        written = True
    acquisition = response.get("fangyuAcquisition", {})
    if not metadata.exists() or overwrite:
        write_json(metadata, {
            "archiveFormatVersion": 1,
            "sourceFile": name,
            "sourceTimestamp": response.get("osm3s", {}).get("timestamp_osm_base"),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "endpoint": acquisition.get("endpoint"),
            "retrievedAt": acquisition.get("retrievedAt"),
            "querySha256": acquisition.get("querySha256"),
            "query": query,
        })
    return written


def archive_existing_cache() -> int:
    archived = 0
    if not CACHE.exists():
        return archived
    for source in sorted(CACHE.glob("*.json")):
        target = RAW / source.name
        if target.exists() and target.with_suffix(".meta.json").exists():
            continue
        try:
            response = read_json(source)
        except (OSError, json.JSONDecodeError):
            continue
        if archive_raw_response(source.name, source.read_bytes(), response):
            archived += 1
    return archived


class Overpass:
    def __init__(self, endpoint: str | None, refresh: bool = False, offline: bool = False):
        self.endpoints = [endpoint] if endpoint else DEFAULT_ENDPOINTS
        self.refresh = refresh
        self.offline = offline
        self.provenance: dict[str, dict] = {}
        self.session = requests.Session() if requests else None
        if self.session:
            self.session.headers.update({"User-Agent": USER_AGENT})
        self.timestamps: set[str] = set()
        self.geometry_cache: dict[int, Path] | None = None

    def cached_geometry(self):
        if self.geometry_cache is None:
            self.geometry_cache = {}
            for filename in sorted(CACHE.glob('relations-*.json')):
                response = read_json(filename)
                if response.get('remark'):
                    continue
                for element in response.get('elements', []):
                    if element.get('type') == 'relation':
                        self.geometry_cache[element['id']] = filename
        return self.geometry_cache

    def query(self, name: str, query: str, cache_name: str, legacy: Path | None = None,
              attempts: int = RETRIES):
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file = CACHE / (cache_name + ".json")
        source = cache_file if cache_file.exists() else legacy
        if source and source.exists() and not self.refresh:
            result = read_json(source)
            if result.get('remark') or not result.get('elements'):
                raise RuntimeError(f"Invalid cached response: {source}")
            self.timestamps.add(result.get("osm3s", {}).get("timestamp_osm_base", ""))
            if source != cache_file:
                write_json(cache_file, result)
            archive_file = RAW / cache_file.name
            if not archive_file.exists() or not archive_file.with_suffix(".meta.json").exists():
                archive_raw_response(cache_file.name, source.read_bytes(), result, query=query)
            self.record_provenance(cache_file, result, legacy=source != cache_file)
            print(f"缓存 {name}: {cache_file.name}", flush=True)
            return result
        if self.offline:
            raise RuntimeError(f"离线缓存缺失：{cache_name}")
        if self.session is None:
            raise RuntimeError("OSM downloads require requests; install scripts/requirements-osm.txt.")

        body = query.strip()
        last_error = None
        for attempt in range(1, attempts + 1):
            for endpoint in self.endpoints:
                try:
                    print(f"下载 {name}（{attempt}/{attempts}）：{endpoint}", flush=True)
                    response = self.session.post(
                        endpoint,
                        data=body.encode("utf-8"),
                        timeout=(20, 180),
                    )
                    response.raise_for_status()
                    result = response.json()
                    if result.get("remark") or not result.get("elements"):
                        raise RuntimeError(result.get("remark") or "Overpass returned no elements")
                    result["fangyuAcquisition"] = {
                        "endpoint": response.url,
                        "retrievedAt": datetime.now(timezone.utc).isoformat(),
                        "querySha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                    }
                    archive_raw_response(
                        cache_file.name,
                        response.content,
                        result,
                        query=body,
                        overwrite=True,
                    )
                    write_json(cache_file, result)
                    self.record_provenance(cache_file, result)
                    self.timestamps.add(result.get("osm3s", {}).get("timestamp_osm_base", ""))
                    time.sleep(5)
                    return result
                except (requests.RequestException, ValueError, RuntimeError) as error:
                    last_error = error
                    print(f"  失败：{error}", file=sys.stderr, flush=True)
                    if isinstance(error, requests.HTTPError) and error.response.status_code == 429:
                        retry_after = error.response.headers.get('Retry-After', '')
                        time.sleep(min(120, max(30, int(retry_after) if retry_after.isdigit() else 30)))
            if attempt < attempts:
                time.sleep(min(60, 5 * attempt))
        raise RuntimeError(f"{name} 下载失败：{last_error}") from last_error

    def record_provenance(self, filename: Path, response: dict, legacy: bool = False):
        self.timestamps.add(response.get('osm3s', {}).get('timestamp_osm_base', ''))
        self.provenance[str(filename)] = {
            **response.get('fangyuAcquisition', {}),
            'sourceTimestamp': response.get('osm3s', {}).get('timestamp_osm_base'),
            'sha256': hashlib.sha256(filename.read_bytes()).hexdigest(),
            'legacyCache': legacy or not bool(response.get('fangyuAcquisition')),
        }


def old_query_file(body: str, generation: str | None = None) -> Path:
    date = f'[date:"{generation}"]' if generation else ''
    query = f'[out:json][timeout:180]{date};{body}'
    return LEGACY / (hashlib.sha256(query.encode('utf-8')).hexdigest() + '.json')


def download_relations(client: Overpass, ids: list[int], generation: str | None = None):
    inputs, missing = [], []
    for relation_id in ids:
        old = LEGACY / 'relations' / (generation or '').replace(':', '-') / f'{relation_id}.json'
        if generation and old.exists() and not client.refresh:
            relation = read_json(old)
            if relation.get('type') == 'relation' and any(m.get('geometry') for m in relation.get('members', [])):
                inputs.append(str(old))
                # The former cache did not retain per-relation response dates.
                client.provenance[str(old)] = {'legacyCache': True, 'sourceTimestamp': None,
                    'cacheGeneration': generation, 'sha256': hashlib.sha256(old.read_bytes()).hexdigest()}
                continue
        cached = client.cached_geometry().get(relation_id) if not client.refresh else None
        if cached:
            if str(cached) not in inputs:
                inputs.append(str(cached))
                client.record_provenance(cached, read_json(cached))
            continue
        missing.append(relation_id)
    def fetch_batch(batch):
        key = hashlib.sha256(','.join(map(str, batch)).encode()).hexdigest()[:20]
        name = f'relations-{key}'
        # Each relation in out geom is complete, including inner/outer way roles.
        # JSON avoids an XML parser but uses the same raw POST as DownloadOsm.py.
        try:
            client.query(f'relations {batch[0]}… ({len(batch)})',
                f'[out:json][timeout:150];rel(id:{",".join(map(str,batch))});out meta geom;', name,
                attempts=2 if len(batch) > 1 else RETRIES)
            inputs.append(str(CACHE / (name + '.json')))
        except RuntimeError:
            if len(batch) == 1:
                raise
            middle = len(batch) // 2
            print(f'拆分失败批次：{len(batch)} → {middle} + {len(batch) - middle}', flush=True)
            fetch_batch(batch[:middle])
            fetch_batch(batch[middle:])
    for offset in range(0, len(missing), 20):
        fetch_batch(missing[offset:offset + 20])
    return inputs


def run_node_job(job: dict) -> dict:
    job_file = CACHE / (job["name"] + ".job.json")
    write_json(job_file, job)
    command = [
        "node",
        str(ROOT / "scripts" / "lib" / "prepare-osm-boundaries.mjs"),
        str(job_file),
    ]
    result = subprocess.run(command, cwd=ROOT, check=False, text=True, encoding='utf-8', capture_output=True)
    if result.stdout:
        print(result.stdout.strip(), flush=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr, flush=True)
        raise RuntimeError(f"离线转换失败：{job['name']}")
    return json.loads(result.stdout.strip().splitlines()[-1])


def prepare_job(client: Overpass, job: dict) -> dict:
    try:
        return run_node_job(job)
    except RuntimeError:
        report_file = Path(job['output'] + '.report.json')
        rejected = read_json(report_file).get('rejected', []) if report_file.exists() else []
        if not rejected:
            raise
        # Inline out geom can omit nested relation members. Fetch the complete
        # descendant graph before attempting conversion again; never publish a
        # partial polygon just because some outer rings survived conversion.
        for identifier in rejected:
            relation_id = int(identifier.split('/')[-1])
            key = f'full-relation-{relation_id}'
            client.query(f'complete descendants {relation_id}',
                f'[out:json][timeout:240];rel({relation_id});(._;>>;);out meta;', key)
            filename = CACHE / (key + '.json')
            job['inputs'].append(str(filename))
            job['provenance'].setdefault('responses', []).append(
                dict(path=str(filename.relative_to(ROOT)), **client.provenance[str(filename)]))
        return run_node_job(job)


def catalog_provinces():
    catalog = read_json(ROOT / "data" / "catalog" / "catalog.json")
    return [row for row in catalog["regions"] if row["scope"] == "china" and row["level"] == 0]


def download_province(client: Overpass, province: dict, apply: bool):
    code = province["code"]
    body = '(rel[boundary=administrative]["ISO3166-2"~"^CN-"];rel[boundary=administrative]["ISO3166-1"~"^(CN|TW|HK|MO)$"];);out tags;'
    index = client.query('province index', '[out:json][timeout:90];' + body,
                         'province-index', old_query_file(body))
    special = {'710000': 'TW', '810000': 'HK', '820000': 'MO'}
    relations = []
    for element in index['elements']:
        tags = element.get('tags', {})
        names = {tags.get(key) for key in ['name', 'name:zh', 'name:zh-Hans', 'official_name']}
        if province['name'] in names or (code in special and tags.get('ISO3166-1') == special[code]):
            relations.append(element)
    if len(relations) != 1:
        raise RuntimeError(f"{province['name']} 省级关系不唯一：{[e.get('id') for e in relations]}")
    province_relation = relations[0]["id"]
    area_id = 3600000000 + province_relation
    levels = '^[4-8]$' if code in special else '^[5-6]$'
    body = f'area({area_id});(rel(area)[boundary=administrative][admin_level~"{levels}"];rel({province_relation}););out tags;'
    generation = index['osm3s']['timestamp_osm_base']
    children = client.query(
        f"{province['name']} child index",
        '[out:json][timeout:90];' + body,
        f"index-{code}-{generation.replace(':','-')}", old_query_file(body, generation),
    )
    ids = sorted({int(e["id"]) for e in children["elements"] if e.get("type") == "relation"})
    relation_ids = sorted(set(ids + [province_relation]))
    reviewed = [row for row in read_json(OUTPUT / 'reviewed-relation-mappings.json')['mappings']
        if row['province'] == code]
    relation_ids = sorted(set(relation_ids + [row['relation'] for row in reviewed]))
    inputs = download_relations(client, relation_ids, generation)
    return prepare_job(client, {
        "name": f"prepare-{code}",
        "kind": "province",
        "code": code,
        "provinceRelation": province_relation,
        "relationIds": relation_ids,
        "reviewedMappings": reviewed,
        "inputs": inputs,
        "output": str(OUTPUT / f"{code}.geojson"),
        "apply": apply,
        "provenance": {
            "responses": [dict(path=str(filename.relative_to(ROOT)), **client.provenance[str(filename)])
                for filename in [CACHE / 'province-index.json',
                    CACHE / f"index-{code}-{generation.replace(':','-')}.json",
                    *map(Path, inputs)]],
            "catalogVersion": read_json(ROOT / "data/catalog/catalog.json")["version"],
        },
    })


def download_references(client: Overpass):
    # These are explicit OSM disputed-boundary relations. Arunachal Pradesh is
    # included only as context and is never presented as a synonym for South Tibet.
    references = {
        "south-tibet": 3202329,
        "aksai-chin": 2713465,
        "arunachal-pradesh-context": 2027346,
    }
    reports = []
    for name, relation_id in references.items():
        try:
            raw = client.query(
                name,
                f"[out:json][timeout:180];rel({relation_id});out meta geom;",
                f"reference-{relation_id}",
            )
            raw_file = CACHE / f"reference-{relation_id}.json"
            result = run_node_job({
                "name": f"prepare-reference-{relation_id}",
                "kind": "reference",
                "relationIds": [relation_id],
                "inputs": [str(raw_file)],
                "output": str(OUTPUT / "references" / f"{name}.geojson"),
                "apply": False,
                "provenance": {
                    "relation": relation_id,
                    **client.provenance[str(raw_file)],
                    "osmRelationVersion": raw['elements'][0].get('version'),
                    "osmRelationTimestamp": raw['elements'][0].get('timestamp'),
                },
            })
            reports.append({"name": name, "relation": relation_id, "result": result})
        except Exception as error:
            reports.append({"name": name, "relation": relation_id, "error": str(error)})
    write_json(OUTPUT / "references" / "report.json", {
        "purpose": "Later review of disputed boundaries; not applied to catalog geometry.",
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "source": "https://www.openstreetmap.org/copyright",
        "reports": reports,
    })
    if any('error' in row for row in reports):
        raise RuntimeError('One or more reference downloads failed; see references/report.json')


def download_national(client: Overpass, apply: bool):
    inputs = download_relations(client, [270056])
    return prepare_job(client, {'name': 'prepare-national', 'kind': 'national', 'relationIds': [270056],
        'inputs': inputs, 'output': str(OUTPUT / 'national.geojson'), 'apply': apply,
        'provenance': {'responses': [client.provenance[p] for p in inputs]}})


def summarize_applied():
    filename = OUTPUT / 'applied.json'
    if not filename.exists():
        return
    applied = read_json(filename)
    reports = list(applied.get('provinces', {}).values())
    unmatched = [dict(province=r['province'], **item) for r in reports for item in r.get('unmatched', [])]
    write_json(OUTPUT / 'coverage.json', {
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'provinceCount': len(reports),
        'downloadedProvinceRelations': sum(r['downloaded'] for r in reports),
        'matchedRegionCount': sum(len(r['mapped']) for r in reports),
        'catalogChinaRegionCount': len([r for r in read_json(ROOT / 'data/catalog/catalog.json')['regions'] if r['scope'] == 'china']),
        'nationalApplied': bool(applied.get('national', {}).get('applied')),
        'geometrySha256': applied.get('geometrySha256'),
        'unmatchedCurrent': [r for r in unmatched if not r.get('historical')],
        'unmatchedHistorical': [r for r in unmatched if r.get('historical')],
        'provinces': [{'code': r['province'], 'name': r['name'], 'downloaded': r['downloaded'],
            'matched': len(r['mapped']), 'unmatched': len(r['unmatched']),
            'excludedPlaceholders': r.get('excludedPlaceholders', [])} for r in reports],
    })


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--province", help="catalog province code, for example 110000")
    parser.add_argument("--all", action="store_true", help="download all provinces")
    parser.add_argument("--national", action="store_true", help="download national relation 270056")
    parser.add_argument("--offline", action="store_true", help="convert cached data without network requests")
    parser.add_argument("--apply", action="store_true", help="replace matched catalog geometries")
    parser.add_argument("--references", action="store_true", help="download disputed-boundary reference relations")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--endpoint", help="single Overpass endpoint")
    parser.add_argument("--archive-cache", action="store_true",
                        help="copy existing raw Overpass responses into the persistent local archive")
    args = parser.parse_args()
    if not args.province and not args.all and not args.references and not args.national and not args.archive_cache:
        parser.error("指定 --province CODE、--all、--national、--references 或 --archive-cache")
    if args.refresh and args.offline:
        parser.error('--refresh and --offline are mutually exclusive')
    archived = archive_existing_cache()
    if archived:
        print(f"已将 {archived} 份原始 Overpass 响应归档到 {RAW}", flush=True)
    if args.archive_cache:
        return 0
    client = Overpass(args.endpoint or os.environ.get('OVERPASS_URL'), args.refresh, args.offline)
    failures, completed = [], []
    def save_progress(finished=False):
        write_json(OUTPUT / "python-download-report.json", {
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
            "finished": finished,
            "endpoint": client.endpoints,
            "sourceTimestamps": sorted(t for t in client.timestamps if t),
            "method": "requests.Session.post with HTTP Overpass body; cached raw JSON; retries",
            "completed": completed,
            "failures": failures,
        })
    if args.references:
        try:
            download_references(client)
        except Exception as error:
            failures.append(f"references: {error}")
    selected = catalog_provinces() if args.all else [r for r in catalog_provinces() if r["code"] == args.province]
    if args.province and not selected:
        parser.error(f"目录中没有省级代码 {args.province}")
    for province in selected:
        try:
            completed.append(download_province(client, province, args.apply))
        except Exception as error:
            failures.append(f"{province['code']} {province['name']}: {error}")
            print(failures[-1], file=sys.stderr, flush=True)
        save_progress()
    if args.national or args.all:
        try:
            completed.append(download_national(client, args.apply))
        except Exception as error:
            failures.append(f'national: {error}')
    save_progress(finished=True)
    summarize_applied()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('已停止。已完成的缓存可在下次运行时继续使用。', file=sys.stderr)
        raise SystemExit(130)
