"""Render the preserved coarse mask against the new OSM high-water coast."""
import math
import sys
from lib.china_gis import *
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import box

sys.stdout.reconfigure(encoding='utf-8')
base = ROOT / 'data/boundaries/china-policy'
old = shape(read_json(base / 'references/coastal-previous-mask.json')['features'][0]['geometry'])
new = shape(read_json(base / 'land-mask.geojson')['features'][0]['geometry'])
image = Image.new('RGB', (1560, 1540), '#f5f7f9')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 25)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
draw.text((30, 22), '海岸精细化 · 修改前后对照', font=font, fill='#18333b')
draw.text((30, 62), '蓝色陆地与细线：新版 OSM 高潮位岸线    灰线：上一版海岸掩膜    仅显示实际出水陆地', font=small, fill='#516269')
panels = [
    ('福建 · 闽江口', (119.48, 26.00, 119.72, 26.19)),
    ('广东 · 珠海近岸', (113.44, 22.12, 113.80, 22.40)),
    ('浙江 · 宁波象山港外侧', (121.88, 29.72, 122.06, 29.87)),
    ('江苏 · 滨海陆地岸线', (120.79, 32.64, 121.24, 33.02)),
    ('海南 · 海口北岸', (110.16, 19.97, 110.65, 20.13)),
    ('台湾 · 东北海岸', (121.65, 24.98, 122.07, 25.20)),
]
def line_parts(g):
    if g.geom_type in ['LineString', 'LinearRing']:
        return [g]
    return [part for child in getattr(g, 'geoms', []) for part in line_parts(child)]

for i, (title, bounds) in enumerate(panels):
    x0, y0 = 28 + (i % 2) * 776, 110 + (i // 2) * 456
    draw.rounded_rectangle((x0, y0, x0 + 748, y0 + 438), 12, fill='white', outline='#dce3e8')
    draw.text((x0 + 16, y0 + 12), title, font=small, fill='#243b46')
    left, top, width, height = x0 + 18, y0 + 52, 712, 338
    west, south, east, north = bounds
    cos_lat = math.cos(math.radians((south + north) / 2))
    scale = min(width / ((east - west) * cos_lat), height / (north - south))
    margin_x = (width - (east - west) * cos_lat * scale) / 2
    margin_y = (height - (north - south) * scale) / 2
    def xy(point):
        return (left + margin_x + (point[0] - west) * cos_lat * scale,
                top + margin_y + (north - point[1]) * scale)
    window = box(*bounds)
    draw.rectangle((left, top, left + width, top + height), fill='#eef4f3')
    for p in polygons(new.intersection(window)):
        draw.polygon([xy(q) for q in p.exterior.coords], fill='#cee7e6')
        for hole in p.interiors:
            draw.polygon([xy(q) for q in hole.coords], fill='#eef4f3')
    for line in line_parts(old.boundary.intersection(window)):
        draw.line([xy(q) for q in line.coords], fill='#81898d', width=1)
    for line in line_parts(new.boundary.intersection(window)):
        draw.line([xy(q) for q in line.coords], fill='#16798a', width=1)
    draw.text((x0 + 16, y0 + 401), f'{west:g}–{east:g}°E  /  {south:g}–{north:g}°N', font=small, fill='#60717a')
draw.text((30, 1491), '© OpenStreetMap contributors · ODbL 1.0；旧参考海岸仅作对照。最终省市县描边另经前端页面验收。', font=small, fill='#516269')
image.save(base / 'coastal-review.png')
print(base / 'coastal-review.png', flush=True)
