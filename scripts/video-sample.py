"""Make the original four-second practice clip. Requires Pillow and imageio-ffmpeg.
The checked-in media is ready to use; normal builds do not need an encoder.
"""
from pathlib import Path
import math,shutil,subprocess
import imageio_ffmpeg
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
width,height,fps,seconds=960,640,24,4
base=Image.new('RGB',(width,height));draw=ImageDraw.Draw(base)
for y in range(height):
    t=y/height;color=tuple(round(a+(b-a)*t) for a,b in zip((29,59,81),(165,188,199)));draw.line((0,y,width,y),fill=color)
draw.polygon([(0,440),(200,208),(368,386),(514,122),(766,440),(864,323),(960,456),(960,640),(0,640)],fill='#536977')
draw.polygon([(514,122),(597,228),(533,207),(490,244),(450,231)],fill='#d2d8d7')
draw.polygon([(0,440),(242,317),(419,475),(701,330),(960,475),(960,640),(0,640)],fill='#344d5b')
for y in range(477,height):
    t=(y-477)/(height-477);color=tuple(round(a+(b-a)*t) for a,b in zip((113,141,157),(34,59,73)));draw.line((0,y,width,y),fill=color)
def frame(index):
    image=base.copy();d=ImageDraw.Draw(image);phase=index/fps
    moonx=707+phase*1.3;moony=144-phase*.6
    d.ellipse((moonx-53,moony-53,moonx+53,moony+53),fill='#e6e5d9')
    for line in range(11):
        y=498+line*12;span=38+line*9;x=moonx+math.sin(phase*1.5+line*.9)*10
        d.line((round(x-span/2),y,round(x+span/2),y),fill=(144+line*2,165+line*2,175+line*2),width=2)
    return image
poster=root/'docs/demo/video-poster.png';frame(0).save(poster)
for kind in ['mp4','webm']:
    destination=root/f'docs/demo/rightsave-demo.{kind}'
    codec=['-c:v','libx264','-preset','veryfast','-crf','26','-c:a','aac','-b:a','48k','-movflags','+faststart'] if kind=='mp4' else ['-c:v','libvpx-vp9','-b:v','0','-crf','36','-deadline','good','-cpu-used','4','-c:a','libopus','-b:a','24k']
    command=[imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-f','lavfi','-i',f'sine=frequency=440:sample_rate=48000:duration={seconds}','-af','volume=0.07,afade=t=in:d=0.25,afade=t=out:st=3.5:d=0.5','-map','0:v:0','-map','1:a:0','-pix_fmt','yuv420p',*codec,'-t',str(seconds),str(destination)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    for index in range(fps*seconds):process.stdin.write(frame(index).tobytes())
    process.stdin.close();error=process.stderr.read();assert process.wait()==0,error.decode(errors='replace')
    print(f'{destination.name}: {destination.stat().st_size:,} bytes; {width}x{height}, {seconds}s, picture and sound')
shutil.copyfile(root/'docs/demo/rightsave-demo.webm',root/'extension/practice.webm')
shutil.copyfile(poster,root/'extension/practice-video-poster.png')
