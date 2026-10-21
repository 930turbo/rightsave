"""Prepare store promo sizes from original code-generated branding and icons."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import shutil
root=Path(__file__).resolve().parents[1];out=root/'store'/'assets';out.mkdir(parents=True,exist_ok=True)
font_path=next((p for p in [Path('C:/Windows/Fonts/bahnschrift.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if p.exists()),None)
def font(size):return ImageFont.truetype(str(font_path),size) if font_path else ImageFont.load_default()
for width,height,name in [(440,280,'promo-440x280.png'),(1400,560,'marquee-1400x560.png')]:
    scale=width/440;im=Image.new('RGB',(width,height),'#08090b');d=ImageDraw.Draw(im);pad=round(28*scale)
    icon=Image.open(root/'extension'/'icons'/'128.png').convert('RGBA');icon.thumbnail((round(33*scale),round(33*scale)),Image.Resampling.LANCZOS)
    im.paste(icon,(pad,pad),icon)
    d.text((pad+round(44*scale),pad), 'RightSave',font=font(round(22*scale)),fill='#f1f3f5')
    d.line((pad,pad+round(50*scale),width-pad,pad+round(50*scale)),fill='#34383e')
    title_y=round(height*.41)
    d.text((pad,title_y),'See it. Save it.',font=font(round(40*scale)),fill='#f1f3f5')
    d.text((pad,title_y+round(57*scale)),'Your media. Your folder.',font=font(round(17*scale)),fill='#a3a7ae')
    im.save(out/name)
shutil.copyfile(root/'extension'/'icons'/'128.png',out/'icon-128.png')
for name,size in [('library-1280x800.png',(1280,800)),('saving-1280x800.png',(1280,800)),('promo-440x280.png',(440,280)),('marquee-1400x560.png',(1400,560)),('icon-128.png',(128,128))]:
    assert Image.open(out/name).size==size,name
print('Verified store icon, two screenshots, promo tile, and marquee dimensions.')
