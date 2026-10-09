"""Versioned public data packages: pack, verify, restore or download.

Uses only Python's standard library. Does not include generated assets, temporary
Overpass caches, credentials or personal records. Publication is a separate action.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'data/snapshots/groups.json'
MANIFEST = ROOT / 'data/snapshots/current.json'


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def destination(relative):
    parts = PurePosixPath(relative)
    if parts.is_absolute() or '..' in parts.parts or not parts.parts or parts.parts[0] != 'data':
        raise ValueError(f'Unsafe data path: {relative}')
    target = (ROOT / str(parts)).resolve()
    if not target.is_relative_to(ROOT / 'data'):
        raise ValueError(f'Data path outside workspace: {relative}')
    return target


def pack(args):
    groups = read_json(CONFIG)
    output = Path(args.directory or ROOT / 'data/generated/data-packages').resolve()
    output.mkdir(parents=True, exist_ok=True)
    version = args.version or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not version or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in version):
        raise ValueError('Version must contain only letters, digits, hyphens and underscores')
    manifest = {'formatVersion': 1, 'version': version,
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'catalogVersion': read_json(ROOT / 'data/catalog/catalog.json')['version'],
                'transportBaseUrl': args.base_url, 'packages': []}
    seen = set()
    for group, patterns in groups.items():
        paths = sorted({p for pattern in patterns for p in ROOT.glob(pattern) if p.is_file()})
        if not paths:
            raise ValueError(f'No data found for group: {group}')
        files = []
        for path in paths:
            relative = path.relative_to(ROOT).as_posix()
            destination(relative)
            if relative in seen:
                raise ValueError(f'Duplicate package entry: {relative}')
            seen.add(relative)
            files.append({'path': relative, 'bytes': path.stat().st_size, 'sha256': sha256(path)})
        name = f'fangyu-data-{group}-{version}.tar.gz'
        archive = output / name
        if archive.exists():
            raise ValueError(f'Snapshot asset already exists: {name}. Choose a new version.')
        temporary = archive.with_suffix(archive.suffix + '.tmp')
        print(f'Pack {group}: {len(files)} files', flush=True)
        with tarfile.open(temporary, 'w:gz', compresslevel=6) as tar:
            for path, item in zip(paths, files):
                tar.add(path, arcname=item['path'], recursive=False)
        temporary.replace(archive)
        manifest['packages'].append({'group': group, 'file': name,
            'bytes': archive.stat().st_size, 'sha256': sha256(archive), 'files': files})
        print(f'  {name}: {archive.stat().st_size / 1024**2:.1f} MiB', flush=True)
    write_json(MANIFEST, manifest)
    write_json(output / 'current.json', manifest)
    print(f'Manifest: {MANIFEST}', flush=True)


def selected_packages(args):
    manifest = read_json(args.manifest or MANIFEST)
    if manifest.get('formatVersion') != 1:
        raise ValueError('Unsupported snapshot manifest format')
    selected = manifest['packages']
    if args.group:
        selected = [p for p in selected if p['group'] in args.group]
        if {p['group'] for p in selected} != set(args.group):
            raise ValueError('Unknown package group')
    return manifest, selected


def verify(args):
    manifest, packages = selected_packages(args)
    failures = []
    for package in packages:
        for item in package['files']:
            target = destination(item['path'])
            if not target.is_file() or target.stat().st_size != item['bytes'] or sha256(target) != item['sha256']:
                failures.append(item['path'])
    if failures:
        raise ValueError('Missing or changed snapshot files:\n' + '\n'.join(failures))
    print(f'Verified snapshot {manifest["version"]}: {sum(len(p["files"]) for p in packages)} files')


def restore(args):
    manifest, packages = selected_packages(args)
    directory = Path(args.directory or ROOT / 'data/generated/data-packages').resolve()
    base_url = args.base_url or manifest.get('transportBaseUrl')
    directory.mkdir(parents=True, exist_ok=True)
    # Check every requested archive and staged file before changing live data.
    with tempfile.TemporaryDirectory(prefix='restore-', dir=directory) as temporary:
        staging = Path(temporary)
        staged = []
        for package in packages:
            name = package['file']
            if Path(name).name != name:
                raise ValueError('Unsafe archive name')
            archive = directory / name
            if not archive.exists():
                if not base_url:
                    raise ValueError(f'Package missing: {archive}. Supply --directory or --base-url.')
                url = base_url.rstrip('/') + '/' + urllib.parse.quote(name)
                if urllib.parse.urlparse(url).scheme not in ('https', 'http'):
                    raise ValueError('Download URL must use HTTP(S)')
                print(f'Download {name}', flush=True)
                request = urllib.request.Request(url, headers={'User-Agent': 'FangyuDataSnapshot/1.0'})
                partial = archive.with_suffix(archive.suffix + '.download')
                with urllib.request.urlopen(request, timeout=180) as response, partial.open('wb') as stream:
                    shutil.copyfileobj(response, stream)
                partial.replace(archive)
            if archive.stat().st_size != package['bytes'] or sha256(archive) != package['sha256']:
                raise ValueError(f'Archive checksum mismatch: {archive}')
            expected = {f['path']: f for f in package['files']}
            received = set()
            with tarfile.open(archive, 'r:gz') as tar:
                for member in tar:
                    if member.name not in expected or not member.isfile() or member.name in received:
                        raise ValueError(f'Unexpected archive member: {member.name}')
                    destination(member.name)
                    item = expected[member.name]
                    if member.size != item['bytes']:
                        raise ValueError(f'File size mismatch: {member.name}')
                    received.add(member.name)
                    local = staging / member.name
                    local.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(member) as source, local.open('wb') as target:
                        shutil.copyfileobj(source, target)
                    if sha256(local) != item['sha256']:
                        raise ValueError(f'File checksum mismatch: {member.name}')
                    staged.append((local, destination(member.name)))
            if received != set(expected):
                raise ValueError(f'Archive missing files: {name}')
        conflicts = [str(target.relative_to(ROOT)) for local, target in staged
                     if target.exists() and sha256(target) != sha256(local)]
        if conflicts and not args.overwrite:
            raise ValueError('Local data differs; use --overwrite after saving local edits:\n' + '\n'.join(conflicts))
        changed = 0
        for local, target in staged:
            if target.exists() and sha256(target) == sha256(local):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temp_target = target.with_suffix(target.suffix + '.snapshot-tmp')
            shutil.copyfile(local, temp_target)
            os.replace(temp_target, target)
            changed += 1
    print(f'Restored {manifest["version"]}: {changed} files changed; all SHA-256 checks passed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['pack', 'verify', 'restore'])
    parser.add_argument('--directory', help='directory containing packaged archives')
    parser.add_argument('--version', help='snapshot version for pack')
    parser.add_argument('--manifest', help='manifest path for verify/restore')
    parser.add_argument('--base-url', help='shared HTTP(S) directory or GitHub Release asset base URL')
    parser.add_argument('--group', action='append', help='runtime, osm-source or research (repeatable)')
    parser.add_argument('--overwrite', action='store_true', help='restore over differing local files')
    args = parser.parse_args()
    {'pack': pack, 'verify': verify, 'restore': restore}[args.action](args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, tarfile.TarError) as error:
        raise SystemExit(str(error))
