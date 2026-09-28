"""Streaming ZIP64 creation and reopen verification; standard library only."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile


def main():
    os.umask(0o077)
    root = Path(sys.argv[1]).resolve(strict=True)
    archive = Path(sys.argv[2])
    entries = json.load(sys.stdin)
    names = set()
    for entry in entries:
        name = entry['path']
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or name in names:
            raise ValueError('Unsafe archive path')
        target = root / name
        if target.resolve(strict=True) != target or not target.is_file():
            raise ValueError('Unsafe archive source')
        names.add(name)
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED, allowZip64=True) as output:
        for entry in entries:
            output.write(root / entry['path'], entry['path'])
    with zipfile.ZipFile(archive, 'r') as output:
        if set(output.namelist()) != names or len(output.namelist()) != len(names):
            raise ValueError('Archive inventory mismatch')
        for entry in entries:
            checksum = hashlib.sha256()
            size = 0
            with output.open(entry['path']) as source:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > entry['sizeBytes']:
                        raise ValueError('Archive size mismatch')
                    checksum.update(chunk)
            if size != entry['sizeBytes'] or checksum.hexdigest() != entry['sha256']:
                raise ValueError('Archive integrity mismatch')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Archive creation or verification failed', file=sys.stderr)
        sys.exit(1)
