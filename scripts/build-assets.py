"""Generate original 5x7 pixel font and icons; Python standard library only."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent / 'assets'
ROOT.mkdir(exist_ok=True)
P = {
 'A':'01110/10001/10001/11111/10001/10001/10001',
 'B':'11110/10001/10001/11110/10001/10001/11110',
 'C':'01111/10000/10000/10000/10000/10000/01111',
 'D':'11110/10001/10001/10001/10001/10001/11110',
 'E':'11111/10000/10000/11110/10000/10000/11111',
 'F':'11111/10000/10000/11110/10000/10000/10000',
 'G':'01111/10000/10000/10111/10001/10001/01111',
 'H':'10001/10001/10001/11111/10001/10001/10001',
 'I':'11111/00100/00100/00100/00100/00100/11111',
 'J':'00111/00010/00010/00010/10010/10010/01100',
 'K':'10001/10010/10100/11000/10100/10010/10001',
 'L':'10000/10000/10000/10000/10000/10000/11111',
 'M':'10001/11011/10101/10101/10001/10001/10001',
 'N':'10001/11001/11001/10101/10011/10011/10001',
 'O':'01110/10001/10001/10001/10001/10001/01110',
 'P':'11110/10001/10001/11110/10000/10000/10000',
 'Q':'01110/10001/10001/10001/10101/10010/01101',
 'R':'11110/10001/10001/11110/10100/10010/10001',
 'S':'01111/10000/10000/01110/00001/00001/11110',
 'T':'11111/00100/00100/00100/00100/00100/00100',
 'U':'10001/10001/10001/10001/10001/10001/01110',
 'V':'10001/10001/10001/10001/10001/01010/00100',
 'W':'10001/10001/10001/10101/10101/11011/10001',
 'X':'10001/10001/01010/00100/01010/10001/10001',
 'Y':'10001/10001/01010/00100/00100/00100/00100',
 'Z':'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110',
 '1':'00100/01100/00100/00100/00100/00100/01110',
 '2':'01110/10001/00001/00010/00100/01000/11111',
 '3':'11110/00001/00001/01110/00001/00001/11110',
 '4':'00010/00110/01010/10010/11111/00010/00010',
 '5':'11111/10000/10000/11110/00001/00001/11110',
 '6':'01110/10000/10000/11110/10001/10001/01110',
 '7':'11111/00001/00010/00100/01000/01000/01000',
 '8':'01110/10001/10001/01110/10001/10001/01110',
 '9':'01110/10001/10001/01111/00001/00001/01110',
 '?':'01110/10001/00001/00010/00100/00000/00100',
 '!':'00100/00100/00100/00100/00100/00000/00100',
 '.':'00000/00000/00000/00000/00000/00100/00100',
 ',':'00000/00000/00000/00000/00100/00100/01000',
 ':':'00000/00100/00100/00000/00100/00100/00000',
 ';':'00000/00100/00100/00000/00100/00100/01000',
 '-':'00000/00000/00000/11111/00000/00000/00000',
 '/':'00001/00001/00010/00100/01000/10000/10000',
 "'":'00100/00100/00000/00000/00000/00000/00000',
 '"':'01010/01010/00000/00000/00000/00000/00000',
 '(':'00010/00100/01000/01000/01000/00100/00010',
 ')':'01000/00100/00010/00010/00010/00100/01000',
 '+':'00000/00100/00100/11111/00100/00100/00000',
 '=':'00000/00000/11111/00000/11111/00000/00000',
 '·':'00000/00000/00000/00100/00000/00000/00000',
 '[':'01110/01000/01000/01000/01000/01000/01110',
 ']':'01110/00010/00010/00010/00010/00010/01110',
 '_':'00000/00000/00000/00000/00000/00000/11111',
 '%':'11001/11010/00010/00100/01000/01011/10011',
 '#':'01010/01010/11111/01010/11111/01010/01010',
 ' ':'00000/00000/00000/00000/00000/00000/00000',
}

def u16(*values): return struct.pack('>' + 'H' * len(values), *values)
def i16(*values): return struct.pack('>' + 'h' * len(values), *values)
def u32(*values): return struct.pack('>' + 'I' * len(values), *values)
def pad(blob): return blob + b'\0' * ((-len(blob)) % 4)
def checksum(blob): return sum(struct.unpack('>' + 'I' * (len(pad(blob)) // 4), pad(blob))) & 0xffffffff

chars = sorted({**P, **{c.lower(): p for c, p in P.items() if c.isalpha()}})
patterns = [P['?']] + [P.get(c, P.get(c.upper())) for c in chars]
glyphs, offsets = [], [0]
for pattern in patterns:
    points = []
    for row, line in enumerate(pattern.split('/')):
        for col, pixel in enumerate(line):
            if pixel == '1':
                x, y = col * 100, (6 - row) * 100
                points.extend([(x,y),(x,y+100),(x+100,y+100),(x+100,y)])
    contours = len(points) // 4
    if not contours:
        blob = i16(0,0,0,0,0) + u16(0)
    else:
        blob = i16(contours,0,0,500,700) + u16(*[i*4+3 for i in range(contours)]) + u16(0)
        blob += bytes([1]) * len(points)
        for axis in (0,1):
            previous = 0
            for point in points:
                blob += i16(point[axis] - previous)
                previous = point[axis]
    glyphs.append(pad(blob))
    offsets.append(offsets[-1] + len(glyphs[-1]))

n = len(patterns)
tables = {}
tables['glyf'] = b''.join(glyphs)
tables['loca'] = u32(*offsets)
tables['hmtx'] = (u16(600) + i16(0)) * n
tables['head'] = u32(0x10000,0x10000,0,0x5f0f3cf5) + u16(3,1000) + b'\0'*16 + i16(0,0,500,700) + u16(0,8) + i16(2,1,0)
tables['hhea'] = u32(0x10000) + i16(800,-200,100) + u16(600) + i16(0,100,500,1,0,0,0,0,0,0,0) + u16(n)
tables['maxp'] = u32(0x10000) + u16(n,140,35,0,0,2,0,0,0,0,0,0,0,0)
# Format 4 cmap, one segment per encoded character plus sentinel.
codes = [ord(c) for c in chars] + [65535]
count = len(codes)
power = 2 ** (count.bit_length() - 1)
cmap = u16(4,16+8*count,0,count*2,power*2,power.bit_length()-1,count*2-power*2)
cmap += u16(*codes) + u16(0) + u16(*codes)
cmap += u16(*[((i+1-code) & 65535) for i,code in enumerate(codes[:-1])],1) + u16(*([0]*count))
tables['cmap'] = u16(0,1,3,1) + u32(12) + cmap
names = {1:'Focus Guard Pixel',2:'Regular',3:'FocusGuardPixel-1',4:'Focus Guard Pixel',5:'Version 1.0',6:'FocusGuardPixel'}
records, strings = b'', b''
for name_id, text in names.items():
    encoded = text.encode('utf-16-be')
    records += u16(3,1,0x409,name_id,len(encoded),len(strings))
    strings += encoded
tables['name'] = u16(0,len(names),6+12*len(names)) + records + strings
tables['post'] = u32(0x30000,0) + i16(-100,50) + u32(1,0,0,0,0)
os2 = bytearray(78)
struct.pack_into('>HhHHH',os2,0,0,600,400,5,0)
struct.pack_into('>hhhhhhhhhh',os2,10,650,600,0,75,650,600,0,350,50,250)
os2[32:42] = bytes([2,11,6,9,2,2,2,2,2,4])
os2[58:62] = b'FGPX'
struct.pack_into('>HHHhhhHH',os2,62,64,min(codes),max(codes[:-1]),800,-200,100,800,200)
tables['OS/2'] = bytes(os2)

tags = sorted(tables)
offset = 12 + 16*len(tags)
directory, payload = b'', b''
for tag in tags:
    blob = tables[tag]
    directory += tag.encode() + u32(checksum(blob),offset,len(blob))
    payload += pad(blob)
    offset += len(pad(blob))
power = 2 ** (len(tags).bit_length()-1)
sfnt = u32(0x10000) + u16(len(tags),16*power,power.bit_length()-1,len(tags)*16-16*power) + directory + payload
adjustment = (0xb1b0afba - checksum(sfnt)) & 0xffffffff
tables['head'] = tables['head'][:8] + u32(adjustment) + tables['head'][12:]
offset = 44 + 20*len(tags)
directory, payload = b'', b''
for tag in tags:
    blob = tables[tag]
    compressed = zlib.compress(blob)
    stored = compressed if len(compressed) < len(blob) else blob
    # Head's directory checksum excludes checkSumAdjustment.
    original = blob[:8] + b'\0'*4 + blob[12:] if tag == 'head' else blob
    directory += tag.encode() + u32(offset,len(stored),len(blob),checksum(original))
    payload += pad(stored)
    offset += len(pad(stored))
header = struct.pack('>4sIIHHIHHIIIII',b'wOFF',0x10000,offset,len(tags),0,len(sfnt),1,0,0,0,0,0,0)
(ROOT/'pixel.woff').write_bytes(header+directory+payload)

def png_chunk(kind, content):
    return struct.pack('>I',len(content)) + kind + content + struct.pack('>I',zlib.crc32(kind+content)&0xffffffff)
for size in (16,32,48,128):
    raw = b''
    for y in range(size):
        raw += b'\0'
        for x in range(size):
            px, py = x*16//size, y*16//size
            color = (92,183,226,255)
            if 1<=px<=14 and 1<=py<=14: color=(20,45,78,255)
            if 3<=px<=12 and 3<=py<=12: color=(249,191,59,255)
            if 4<=px<=11 and py==3 or px==3 and 4<=py<=11: color=(255,226,128,255)
            if (px in (5,6) and 5<=py<=11) or (5<=px<=10 and py in (5,6,8)):
                color=(20,45,78,255)
            raw += bytes(color)
    header = struct.pack('>IIBBBBB',size,size,8,6,0,0,0)
    (ROOT/f'icon{size}.png').write_bytes(b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',header)+png_chunk(b'IDAT',zlib.compress(raw))+png_chunk(b'IEND',b''))
print('Generated original font and four icons.')
