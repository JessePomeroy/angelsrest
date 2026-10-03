"""Read the one bounded release record without extracting archive paths."""

import io
import stat
import sys
import zipfile


def read_record():
    archive = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(archive) > 1024 * 1024:
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        entries = zipped.infolist()
        if len(entries) != 1:
            raise ValueError()
        entry = entries[0]
        mode = entry.external_attr >> 16
        if (
            entry.filename != "build.json"
            or entry.is_dir()
            or stat.S_ISLNK(mode)
            or (stat.S_IFMT(mode) not in (0, stat.S_IFREG))
            or entry.flag_bits & 1
            or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            or entry.file_size > 256 * 1024
        ):
            raise ValueError()
        with zipped.open(entry) as source:
            payload = source.read(256 * 1024 + 1)
        if len(payload) != entry.file_size:
            raise ValueError()
        sys.stdout.buffer.write(payload)


try:
    read_record()
except Exception:
    sys.stderr.write("Invalid release archive.\n")
    sys.exit(1)
