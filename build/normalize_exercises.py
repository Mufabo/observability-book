"""Normalise every chapter's Exercises section to the _STYLE-GUIDE.md form:
one !!! exercise admonition, each item opening **N. Title (difficulty).**"""
import io, os, re, sys, glob

NL = chr(10)
HDR = re.compile(r'^(\s*)(?:\*\*(\d+)\.|(\d+)\.\s+\*\*)')
DIFF = r'(warm-up|core|stretch)'

# Each returns (title, difficulty, rest-of-line) or None.
def parse(line):
    s = line.strip()
    # A: **1. Title (core).**  rest
    m = re.match(r'\*\*(\d+)\.\s+(.*?)\s*\(' + DIFF + r'\)\.\*\*\s*(.*)$', s)
    if m: return m.group(1), m.group(2), m.group(3), m.group(4)
    # A': **5. Title (stretch, requires internet).**
    m = re.match(r'\*\*(\d+)\.\s+(.*?)\s*\(' + DIFF + r',\s*(.*?)\)\.\*\*\s*(.*)$', s)
    if m: return m.group(1), f'{m.group(2)}, {m.group(4)}', m.group(3), m.group(5)
    # E: **1. Title. (core)**  rest
    m = re.match(r'\*\*(\d+)\.\s+(.*?)\.?\s*\(' + DIFF + r'\)\*\*\s*(.*)$', s)
    if m: return m.group(1), m.group(2), m.group(3), m.group(4)
    # G: **1. (core) Title.**  rest
    m = re.match(r'\*\*(\d+)\.\s+\(' + DIFF + r'\)\s+(.*?)\.?\*\*\s*(.*)$', s)
    if m: return m.group(1), m.group(3), m.group(2), m.group(4)
    # B: **1. Title.** (core) rest
    m = re.match(r'\*\*(\d+)\.\s+(.*?)\.?\*\*\s*\(' + DIFF + r'\)\s*(.*)$', s)
    if m: return m.group(1), m.group(2), m.group(3), m.group(4)
    # C: 1. **(core) Title.** rest
    m = re.match(r'(\d+)\.\s+\*\*\(' + DIFF + r'\)\s+(.*?)\.?\*\*\s*(.*)$', s)
    if m: return m.group(1), m.group(3), m.group(2), m.group(4)
    # F/D: **1. (core)** rest   |   1. **(core)** rest   -> NO TITLE
    m = re.match(r'(?:\*\*(\d+)\.\s+\(' + DIFF + r'\)\*\*|(\d+)\.\s+\*\*\(' + DIFF + r'\)\*\*)\s*(.*)$', s)
    if m:
        n = m.group(1) or m.group(3); d = m.group(2) or m.group(4)
        return n, None, d, m.group(5)
    return None

def dedent(lines, n):
    out = []
    for l in lines:
        if not l.strip(): out.append('')
        else:
            k = len(l) - len(l.lstrip(' '))
            out.append(l[min(k, n):])
    return out

def process(path):
    s = io.open(path, encoding='utf-8').read()
    m = re.search(r'^## Exercises\s*$', s, re.M)
    if not m: return None, 'no Exercises section'
    head, body = s[:m.end()], s[m.end():]
    nx = re.search(r'^## ', body, re.M)
    tail = body[nx.start():] if nx else ''
    body = body[:nx.start()] if nx else body

    lines = body.split('\n')
    starts = [i for i, l in enumerate(lines) if HDR.match(l) and parse(l)]
    if not starts: return None, 'no exercise headers recognised'

    chunks, missing, trailing = [], [], []
    for j, i in enumerate(starts):
        end = starts[j + 1] if j + 1 < len(starts) else len(lines)
        blk = lines[i:end]
        # After the last exercise the section may carry content that is NOT an
        # exercise -- ch23 and ch29 both close with a part-level `!!! note`.
        # Exercise bodies are always indented; a non-blank line at column 0
        # after the final header ends the exercise list.
        if j + 1 == len(starts):
            for k in range(1, len(blk)):
                if blk[k][:1].strip():
                    trailing = blk[k:]
                    blk = blk[:k]
                    break
        while blk and not blk[-1].strip(): blk.pop()
        # drop any stray "!!! exercise" that belongs to the NEXT item
        while blk and blk[-1].strip() == '!!! exercise': blk.pop()
        while blk and not blk[-1].strip(): blk.pop()
        n, title, diff, rest = parse(blk[0])
        h = len(blk[0]) - len(blk[0].lstrip(' '))
        rows = [r for r in blk[1:] if r.strip() and r.strip() != '!!! exercise']
        b = min((len(r) - len(r.lstrip(' ')) for r in rows), default=h)
        tail_lines = dedent([r for r in blk[1:] if r.strip() != '!!! exercise'], b)
        if not title or not title.strip():
            missing.append(n)
            hdr = f'**{n}. @@TITLE@@ ({diff}).** {rest}'.rstrip()
        else:
            hdr = f'**{n}. {title} ({diff}).** {rest}'.rstrip()
        chunks.append([hdr] + tail_lines)

    out = ['', '!!! exercise']
    for k, ch in enumerate(chunks):
        if k: out.append('')
        for l in ch:
            out.append('    ' + l if l.strip() else '')
    while trailing and not trailing[-1].strip():
        trailing.pop()
    if trailing:
        out += [''] + trailing

    body_out = head + NL.join(out) + NL
    return (body_out + NL + tail if tail else body_out), missing

if __name__ == '__main__':
    # Run from manuscript/.  Dry run by default; --write commits.
    #   python ../build/normalize_exercises.py
    #   python ../build/normalize_exercises.py --write --skip 12,13,14
    # --skip exists because a chapter being rewritten by a verification agent
    # must not be touched underneath it.
    write = '--write' in sys.argv
    skip = set()
    if '--skip' in sys.argv:
        skip = {int(x) for x in sys.argv[sys.argv.index('--skip') + 1].split(',')}
    here = os.path.basename(os.getcwd())
    if not glob.glob('ch??-*.md'):
        sys.exit(f'no ch??-*.md here ({here}) - run this from manuscript/')
    for p in sorted(glob.glob('ch??-*.md')):
        n = int(p[2:4])
        if n in skip: print(f'ch{n:02d}  SKIPPED (--skip)'); continue
        new, info = process(p)
        if new is None: print(f'ch{n:02d}  !! {info}'); continue
        old = io.open(p, encoding='utf-8').read()
        if new == old: print(f'ch{n:02d}  already conforming'); continue
        if info:
            # A title has to be written, not generated. Left for a human pass.
            print(f'ch{n:02d}  HELD BACK - needs titles for {info}')
            continue
        print(f'ch{n:02d}  rewritten')
        if write: io.open(p, 'w', encoding='utf-8', newline='\n').write(new)
