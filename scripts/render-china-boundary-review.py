"""Render an offline before/after map sheet from preserved and published geometry."""
import math
import sys
from lib.china_gis import *
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import box

sys.stdout.reconfigure(encoding='utf-8')
base = ROOT / 'data/boundaries/china-policy'
regions = {r['id']: r for r in read_json(ROOT / 'data/catalog/catalog.json')['regions']}
before = read_json(base / 'references/policy-before-20261006.json')
after = read_json(ROOT / 'data/catalog/china.geo.json')
def geometry(rows, code):
    values = [polygonal(shape(r['geometry'])) for r in rows if r['level'] != 'border' and regions.get(r['regionId'], {}).get('code') == code]
    return polygonal(unary_union(values))
image = Image.new('RGB', (1560, 1640), '#f5f7f9')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
draw.text((35, 24), '中国边界本地校订 · 修改前后对照', fill='#182d38', font=font)
draw.text((35, 62), '蓝色：校订后陆地及边界    灰色线：原几何    橙色：配套邻区    预览已简化，源数据保持完整', fill='#44535b', font=small)
panels = [
    ('汉南：四街道拼接；蔡甸补回托管三街道', ['420113'], ['420114'], (113.68, 30.15, 114.28, 30.71)),
    ('文登：保留小观，按十五镇街重建', ['371003'], ['371002'], (121.69, 36.8, 122.43, 37.78)),
    ('唐古拉：格尔木及玉树方向正式县界', ['632801'], ['632722', '632724', '540624'], (88.8, 31.9, 94.8, 35.1)),
    ('藏南：以官方省界与县界核验', ['540000'], [], (90.5, 26.6, 98.0, 30.1)),
    ('黑瞎子岛：两河中流到汇合处', ['230883'], [], (134.4, 48.15, 135.16, 48.53)),
    ('西沙与南沙：仅保留已取得实际陆地面', ['460302', '460303'], [], (109, 4.8, 118.2, 17.4)),
]
for i, (title, codes, neighbors, bounds) in enumerate(panels):
    x0, y0 = 28 + (i % 2) * 776, 112 + (i // 2) * 488
    draw.rounded_rectangle((x0, y0, x0 + 748, y0 + 465), 12, fill='white', outline='#dce3e8')
    draw.text((x0 + 16, y0 + 13), title, font=small, fill='#243b46')
    left, top, width, height = x0 + 24, y0 + 56, 698, 366
    west, south, east, north = bounds
    cos_lat = math.cos(math.radians((south + north) / 2))
    scale = min(width / ((east - west) * cos_lat), height / (north - south))
    margin_x = (width - (east - west) * cos_lat * scale) / 2
    margin_y = (height - (north - south) * scale) / 2
    def xy(point):
        return (left + margin_x + (point[0] - west) * cos_lat * scale,
                top + margin_y + (north - point[1]) * scale)
    def paint(g, fill=None, stroke=None, stroke_width=1):
        g = polygonal(g.intersection(box(*bounds))).simplify(0.0001, preserve_topology=True)
        for p in polygons(g):
            points = [xy(q) for q in p.exterior.coords]
            if fill:
                draw.polygon(points, fill=fill)
                for hole in p.interiors:
                    draw.polygon([xy(q) for q in hole.coords], fill='white')
            if stroke:
                draw.line(points, fill=stroke, width=stroke_width)
    for code in neighbors:
        paint(geometry(after, code), fill='#ffe5c5', stroke='#d99040')
    for code in codes:
        paint(geometry(after, code), fill='#c7e4f5', stroke='#187ba8', stroke_width=2)
    for code in codes:
        paint(geometry(before, code), stroke='#6c7780', stroke_width=1)
    draw.text((x0 + 18, y0 + 433), f'经度 {west:g}–{east:g}°    纬度 {south:g}–{north:g}°', fill='#60717a', font=small)
draw.text((35, 1580), '海岸部分使用已确认的参考数据；未完成与精度限制见整理报告。三沙概览未放大微小岛屿，也未添加礁滩符号。', fill='#52616b', font=small)
destination = base / 'review.png'
image.save(destination)
print(destination, flush=True)
