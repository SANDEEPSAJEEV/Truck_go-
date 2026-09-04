"""Parse the decompiled i18n object literals into a readable catalog.

The Hermes decompiler emits each i18n namespace as `rN = {'key': 'value', ...};`
followed by an indexed assignment into a parent slot. Namespace *names* live in a
separate string table, so blocks are labelled here by their most identifying string.
"""
import re
import sys

src_path, out_path, label = sys.argv[1], sys.argv[2], sys.argv[3]

with open(src_path, encoding="utf-8") as f:
    text = f.read()

# Match object literals that look like translation maps (>=2 string:string pairs).
block_re = re.compile(r"r\d+ = (\{'[^\n]*?\});")
pair_re = re.compile(r"'([A-Za-z][A-Za-z0-9_]*)': ('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")")

blocks = []
for m in block_re.finditer(text):
    pairs = pair_re.findall(m.group(1))
    if len(pairs) >= 2:
        blocks.append(pairs)

seen = set()
out = [f"# {label} — recovered UI copy catalog", ""]
out.append(f"Extracted verbatim from the decompiled bundle. {len(blocks)} string groups.")
out.append("Namespace names live in a separate Hermes string table, so each group is")
out.append("labelled by its first key for orientation.")
out.append("")

for pairs in blocks:
    sig = tuple(k for k, _ in pairs)
    if sig in seen:
        continue
    seen.add(sig)
    out.append(f"## {pairs[0][0]} ({len(pairs)} strings)")
    for k, v in pairs:
        out.append(f"- `{k}`: {v}")
    out.append("")

with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print(f"{len(seen)} unique groups -> {out_path}")
