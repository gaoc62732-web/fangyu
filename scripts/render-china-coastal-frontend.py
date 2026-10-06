"""Make a contact sheet from actual browser screenshots, without redrawing GIS."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

base = Path(__file__).resolve().parents[1] / 'data/boundaries/china-policy/coastal-frontend'
canvas = Image.new('RGB', (1640, 720), '#ffffff')
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
caption = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
for i, (name, label) in enumerate([('shandong', '大陆海岸 · 山东荣成'), ('zhoushan', '岛屿轮廓 · 舟山')]):
    source = Image.open(base / (name + '.png')).convert('RGB')
    crop = source.crop((0, 156, source.width, 1010))
    crop.thumbnail((800, 636), Image.Resampling.LANCZOS)
    draw.text((20 + i * 820, 12), label, font=font, fill='#234339')
    canvas.paste(crop, (20 + i * 820, 48))
draw.text((20, 678), '新版前端实图；海岸为普通细线。© OpenStreetMap contributors · ODbL 1.0', font=caption, fill='#234339')
canvas.save(base / 'overview.png')
