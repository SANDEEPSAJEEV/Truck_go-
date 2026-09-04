"""Read the `name` table out of each extracted TTF so we know which icon/text
fonts the original APK actually bundles."""
import struct
import sys
from pathlib import Path

NAME_ID_FAMILY = 1
NAME_ID_FULL = 4


def font_name(path: Path):
    data = path.read_bytes()
    if len(data) < 12:
        return None
    num_tables = struct.unpack(">H", data[4:6])[0]
    name_off = name_len = None
    for i in range(num_tables):
        rec = 12 + i * 16
        if rec + 16 > len(data):
            return None
        tag = data[rec:rec + 4]
        if tag == b"name":
            name_off, name_len = struct.unpack(">II", data[rec + 8:rec + 16])
            break
    if name_off is None or name_off + 6 > len(data):
        return None

    count, string_off = struct.unpack(">HH", data[name_off + 2:name_off + 6])
    storage = name_off + string_off
    best = {}
    for i in range(count):
        rec = name_off + 6 + i * 12
        if rec + 12 > len(data):
            break
        pid, eid, lid, nid, ln, off = struct.unpack(">HHHHHH", data[rec:rec + 12])
        if nid not in (NAME_ID_FAMILY, NAME_ID_FULL):
            continue
        start = storage + off
        raw = data[start:start + ln]
        try:
            txt = raw.decode("utf-16-be" if pid == 3 else "latin-1").strip("\x00").strip()
        except Exception:
            continue
        if txt and nid not in best:
            best[nid] = txt
    return best.get(NAME_ID_FULL) or best.get(NAME_ID_FAMILY)


root = Path(sys.argv[1])
seen = {}
for p in sorted(root.rglob("*.ttf")):
    nm = font_name(p)
    if not nm:
        continue
    seen.setdefault(nm, []).append((p.name, p.stat().st_size))

for nm in sorted(seen):
    files = seen[nm]
    total = sum(s for _, s in files)
    print(f"{nm}  —  {len(files)} file(s), {total:,} bytes")
