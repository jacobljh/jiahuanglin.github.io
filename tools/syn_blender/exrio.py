"""exrio.py - a minimal OpenEXR reader for the files Blender writes here (scanline, single or multipart, codec NONE / ZIPS / ZIP).
Lesson 8 needs the Depth, Object Index and Cryptomatte parts of a multilayer EXR, and Python's image loader of Blender exposes only one pass,
so the passes are decoded here.  read_exr(path) -> {'parts': {part name: {channel name: float32 array (H, W), top row first}}, 'meta': {attribute: str}}"""
import struct, zlib
import numpy as np


def _header(b, pos):
    attrs = {}
    while True:
        end = b.index(b'\0', pos); name = b[pos:end].decode(); pos = end + 1
        if name == '':
            return attrs, pos
        end = b.index(b'\0', pos); typ = b[pos:end].decode(); pos = end + 1
        size = struct.unpack('<i', b[pos:pos + 4])[0]; pos += 4
        attrs[name] = (typ, b[pos:pos + size]); pos += size


def _chlist(raw):
    out, pos = [], 0
    while raw[pos] != 0:
        end = raw.index(b'\0', pos); name = raw[pos:end].decode(); pos = end + 1
        ptype, = struct.unpack('<i', raw[pos:pos + 4]); pos += 16      # type, pLinear + 3 reserved bytes, xSampling, ySampling
        out.append((name, ptype))
    return out


def _unzip(data, n):
    t = bytearray(zlib.decompress(data))
    for i in range(1, len(t)):
        t[i] = (t[i - 1] + t[i] - 128) & 0xFF
    half = (len(t) + 1) // 2
    out = bytearray(len(t)); out[0::2] = t[:half]; out[1::2] = t[half:]
    return bytes(out)


def read_exr(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'\x76\x2f\x31\x01', 'not an OpenEXR file'
    ver, = struct.unpack('<I', b[4:8]); multi = bool(ver & 0x1000); pos = 8; heads = []
    if multi:
        while b[pos] != 0:
            h, pos = _header(b, pos); heads.append(h)
        pos += 1
    else:
        h, pos = _header(b, pos); heads.append(h)
    offs = []
    for h in heads:
        dw = struct.unpack('<4i', h['dataWindow'][1]); hgt = dw[3] - dw[1] + 1; comp = h['compression'][1][0]
        lpb = {0: 1, 1: 1, 2: 1, 3: 16}.get(comp)
        assert lpb is not None, 'unsupported EXR compression %d (use NONE, ZIPS or ZIP)' % comp
        n = struct.unpack('<i', h['chunkCount'][1])[0] if 'chunkCount' in h else (hgt + lpb - 1) // lpb
        offs.append(list(struct.unpack('<%dQ' % n, b[pos:pos + 8 * n]))); pos += 8 * n
    parts, meta = {}, {}
    for pi, h in enumerate(heads):
        dw = struct.unpack('<4i', h['dataWindow'][1]); wid = dw[2] - dw[0] + 1; hgt = dw[3] - dw[1] + 1; comp = h['compression'][1][0]
        chans = _chlist(h['channels'][1]); bpp = [4 if t != 1 else 2 for _, t in chans]; dt = [np.float32 if t == 2 else (np.float16 if t == 1 else np.uint32) for _, t in chans]
        pname = h['name'][1].decode().rstrip('\0') if 'name' in h else 'main'
        planes = {nm: np.zeros((hgt, wid), np.float32) for nm, _ in chans}
        for k, v in h.items():
            if v[0] == 'string' and k.startswith('cryptomatte'):
                meta[(pname, k)] = v[1][4:].decode(errors='replace') if len(v[1]) > 4 and struct.unpack('<i', v[1][:4])[0] == len(v[1]) - 4 else v[1].decode(errors='replace')
        for off in offs[pi]:
            p = off + (4 if multi else 0)
            y, size = struct.unpack('<ii', b[p:p + 8]); data = b[p + 8:p + 8 + size]
            if comp in (2, 3):
                data = _unzip(data, size)
            lines = min(1 if comp < 3 else 16, hgt - (y - dw[1])); q = 0
            for ln in range(lines):
                for (nm, _), nb, d in zip(chans, bpp, dt):
                    planes[nm][y - dw[1] + ln] = np.frombuffer(data[q:q + nb * wid], dtype=d).astype(np.float32); q += nb * wid
        parts[pname] = planes
    return {'parts': parts, 'meta': meta}
