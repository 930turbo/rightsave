"""Generate original monochrome branding and PNG icons. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
icons = root / 'extension' / 'icons'
icons.mkdir(exist_ok=True)
im = Image.new('RGBA', (512, 512))
gradient = Image.new('RGBA', im.size)
g = ImageDraw.Draw(gradient)
for y in range(512):
    t = y / 511
    color = tuple(round(a + (b-a)*t) for a,b in zip((76,83,92),(17,19,22))) + (255,)
    g.line((0,y,512,y),fill=color)
mask = Image.new('L', im.size)
ImageDraw.Draw(mask).rounded_rectangle((16,16,496,496), radius=144, fill=255)
im.paste(gradient,(0,0),mask)
d = ImageDraw.Draw(im)
d.rounded_rectangle((16,16,496,496), radius=144, outline='#7b838d', width=6)
d.line([(256,128),(256,312)],fill='#f1f3f5',width=28)
d.line([(184,240),(256,312),(328,240)],fill='#f1f3f5',width=28,joint='curve')
d.line([(144,336),(144,400),(368,400),(368,336)],fill='#f1f3f5',width=28,joint='curve')
for size in [16,32,48,96,128,256]:
    im.resize((size,size),Image.Resampling.LANCZOS).save(icons/f'{size}.png')

docs = root / 'docs'
font_path = next((p for p in [Path('C:/Windows/Fonts/bahnschrift.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if p.exists()),None)
def font(size):
    return ImageFont.truetype(str(font_path),size) if font_path else ImageFont.load_default()

banner = Image.new('RGB',(1280,640),'#08090b')
b = ImageDraw.Draw(banner)
b.line((56,94,1224,94),fill='#34383e')
icon = im.resize((32,32),Image.Resampling.LANCZOS)
banner.paste(icon,(56,36),icon)
b.text((100,37),'RightSave',font=font(24),fill='#f1f3f5')
b.text((1006,42),'Firefox + Chrome',font=font(17),fill='#a3a7ae')
b.text((51,204),'See it.',font=font(100),fill='#f1f3f5')
b.text((51,300),'Save it.',font=font(100),fill='#f1f3f5')
b.text((58,447),'Images + videos. Your folder.',font=font(24),fill='#a3a7ae')
b.text((58,563),'FREE / LOCAL     FIREFOX + CHROME',font=font(15),fill='#a3a7ae')

shot = docs / 'library.png'
if shot.exists():
    preview = Image.open(shot).convert('RGB')
    preview.thumbnail((704,760),Image.Resampling.LANCZOS)
    banner.paste(preview,(520,130))
    b.line((520,130,1224,130),fill='#34383e')
banner.save(docs/'social-preview.png')
print('Generated glass / raw branding and PNG icons.')
