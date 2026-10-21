import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL('../extension/sites.js', import.meta.url), 'utf8');
const context = vm.createContext({URL});
vm.runInContext(source, context);
const S = context.RightSaveSites;

test('Site matching accepts real subdomains and rejects lookalike domains', () => {
  for (const [url,name] of [['https://www.instagram.com','Instagram'],['https://m.facebook.com','Facebook'],['https://x.com','X'],['https://twitter.com','X'],['https://old.reddit.com','Reddit'],['https://threads.net','Threads'],['https://www.threads.com','Threads'],['https://www.linkedin.com','LinkedIn']]) assert.equal(S.site(url),name);
  for (const url of ['https://notinstagram.com','https://x.com.evil.test','invalid']) assert.equal(S.site(url),'');
});
test('Instagram carousel image candidates and progressive videos retain signed URLs', () => {
  const signed = 'https://scontent.cdninstagram.com/a.mp4?token=keep&oe=123';
  const items = S.extract({items:[{code:'PostAbC',carousel_media:[{image_versions2:{candidates:[{url:'https://scontent.cdninstagram.com/a.jpg',width:1080,height:1350}]}},{video_versions:[{url:signed,width:1080,height:1920}]}]}]},'https://www.instagram.com/');
  assert.equal(items.length,2);assert.equal(items.find(i=>i.kind==='video').url,signed);
  assert.equal(items[1].postURL,'https://www.instagram.com/p/PostAbC/');
});
test('Facebook SD/HD and progressive response fields are discovered', () => {
  const items=S.rank(S.extract({data:{video:{browser_native_sd_url:'https://video.fbcdn.net/sd.mp4?sig=keep',browser_native_hd_url:'https://video.fbcdn.net/hd.mp4?sig=keep'},progressive:[{progressive_url:'https://video.fbcdn.net/other.mp4'}]}},'https://www.facebook.com/watch/?v=123'));
  assert.equal(items.length,3);assert.match(items[0].url,/hd.mp4/);
});
test('X progressive variants are ranked by quality and HLS is not mislabeled MP4', () => {
  const items=S.rank(S.extract({legacy:{id_str:'123456789',full_text:'Example post',extended_entities:{media:[{media_url_https:'https://pbs.twimg.com/media/post.jpg',video_info:{variants:[{url:'https://video.twimg.com/vid/640x360/a.mp4',content_type:'video/mp4',bitrate:800000},{url:'https://video.twimg.com/vid/1280x720/a.mp4',content_type:'video/mp4',bitrate:2000000},{url:'https://video.twimg.com/playlist.m3u8',content_type:'application/x-mpegURL'}]}}]}}},'https://x.com/home').filter(i=>i.kind==='video'));
  assert.equal(items.length,2);assert.equal(items[0].height,720);assert.equal(items[0].postURL,'https://x.com/i/status/123456789');
});
test('Reddit galleries decode entities and fallback video is labeled as separate audio', () => {
  const items=S.extract({data:{permalink:'/r/test/comments/abc123/title/',media_metadata:{x:{e:'Image',s:{u:'https://i.redd.it/a.jpg?x=1&amp;y=2',x:1200,y:800}}},secure_media:{reddit_video:{fallback_url:'https://v.redd.it/id/DASH_720.mp4',has_audio:true,width:1280,height:720,hls_url:'https://v.redd.it/id/HLSPlaylist.m3u8'}}}},'https://www.reddit.com/');
  assert.equal(items.find(i=>i.url.includes('DASH_')).audio,'separate');assert.match(items.find(i=>i.kind==='image').url,/x=1&y=2/);
  assert.equal(items.find(i=>i.url.includes('m3u8')).mime,'application/vnd.apple.mpegurl');
});
test('Threads accepts both domains and extracts carousel media', () => {
  for (const domain of ['threads.net','threads.com']) {
    const items=S.extract({data:{media:{code:'ThreadAbC',video_versions:[{url:'https://scontent.fbcdn.net/thread.mp4',width:1080,height:1920}]}}},'https://www.'+domain);
    assert.equal(items[0].kind,'video');assert.equal(S.postKey(items[0].postURL),'ThreadAbC');
  }
});
test('LinkedIn progressive streams and vector-image artifacts retain path signatures', () => {
  const items=S.extract({included:[{entityUrn:'urn:li:activity:123456789',progressiveStreams:[{width:1280,height:720,streamingLocations:[{url:'https://dms.licdn.com/vid.mp4?e=123&t=keep'}]}]},{rootUrl:'https://media.licdn.com/dms/image/',artifacts:[{width:1600,height:900,fileIdentifyingUrlPathSegment:'image?e=123&t=keep'}]}]},'https://www.linkedin.com/feed/');
  assert.equal(items.length,2);assert.equal(items[0].postURL,'https://www.linkedin.com/feed/update/urn:li:activity:123456789/');assert.match(items[1].url,/t=keep/);
});
test('Original-size candidates rewrite only known unsigned hosts', () => {
  assert.equal(S.imageVariants('https://pbs.twimg.com/media/abc?format=jpg&name=small')[0],'https://pbs.twimg.com/media/abc?format=jpg&name=orig');
  assert.equal(S.imageVariants('https://preview.redd.it/abc.jpg?width=640')[0],'https://i.redd.it/abc.jpg');
  assert.equal(S.imageVariants('https://scontent.cdninstagram.com/a.jpg?signature=keep').length,0);
  assert.equal(S.imageVariants('https://media.licdn.com/a.jpg?signature=keep').length,0);
});
test('Context resolution matches the clicked post or poster and excludes unrelated posts', () => {
  const items=[{kind:'video',url:'https://cdn.test/a.mp4',height:360,postURL:'https://x.com/user/status/111',poster:'https://pbs.twimg.com/media/a.jpg?name=small'},{kind:'video',url:'https://cdn.test/a-hd.mp4',height:1080,postURL:'https://x.com/user/status/111',poster:'https://pbs.twimg.com/media/a.jpg?name=orig'},{kind:'video',url:'https://cdn.test/b.mp4',height:2160,postURL:'https://x.com/user/status/222',poster:'https://pbs.twimg.com/media/b.jpg'}];
  assert.equal(S.related(items,{kind:'video',url:'blob:foo',poster:'https://pbs.twimg.com/media/a.jpg'},[], 'https://x.com/home')[0].url,'https://cdn.test/a-hd.mp4');
  assert.equal(S.related(items,{kind:'video',url:'blob:foo'},['https://x.com/user/status/111'],'https://x.com/home').length,2);
  assert.equal(S.related(items,{kind:'video',url:'blob:unknown'},[], 'https://x.com/home').length,0);
  assert.equal(S.related(items,{kind:'video',url:'blob:foo',poster:'https://pbs.twimg.com/media/a.jpg'},['https://x.com/user/status/111','https://x.com/user/status/222'],'https://x.com/home')[0].url,'https://cdn.test/a-hd.mp4');
  assert.equal(S.related(items,{kind:'video',url:'blob:foo'},['https://x.com/user/status/111','https://x.com/user/status/222'],'https://x.com/home').length,0);
  assert.equal(S.related(items,{kind:'image',url:'https://cdn.test/carousel-slide-3.jpg'},['https://x.com/user/status/111'],'https://x.com/home').length,0);
});
test('JSON parsing handles anti-XSSI and line-delimited data without executing code', () => {
  for (const prefix of ['for (;;);', ")]}'\n",'']) assert.equal(S.parse(prefix+'{"video_url":"https://cdn.test/a.mp4"}','https://facebook.com').length,1);
  assert.equal(S.parse('{"video_url":"https://cdn.test/a.mp4"}\n{"video_url":"https://cdn.test/b.mp4"}','https://facebook.com').length,2);
  assert.equal(S.parse('alert(1)','https://facebook.com').length,0);
});
test('Malformed, executable, credential-bearing and oversized payloads are rejected', () => {
  for (const url of ['javascript:alert(1)','data:text/html,x','https://user:pass@cdn.test/a.mp4','']) assert.equal(S.extract({video_url:url},'https://x.com').length,0);
  assert.equal(S.parse('x'.repeat(2*1024*1024+1),'https://x.com').length,0);
  assert.equal(S.extract({is_drm:true,video_url:'https://cdn.test/drm.mp4'},'https://facebook.com').length,0);
});
test('Walking and extracted results are bounded even for cyclic or oversized structures', () => {
  const cyclic={};cyclic.data=cyclic;assert.equal(S.extract(cyclic,'https://x.com').length,0);
  const items=S.extract(Array.from({length:500},(_,i)=>({video_url:'https://cdn.test/'+i+'.mp4'})),'https://instagram.com');assert.equal(items.length,300);
});
test('Only same-platform API/GraphQL response paths qualify for observation', () => {
  assert.equal(S.responseURL('https://www.instagram.com/api/v1/feed/','https://www.instagram.com'),true);
  assert.equal(S.responseURL('https://www.facebook.com/api/graphql','https://www.facebook.com'),true);
  assert.equal(S.responseURL('https://tracker.test/api/','https://www.instagram.com'),false);
  assert.equal(S.responseURL('https://www.instagram.com/ordinary-page','https://www.instagram.com'),false);
});
test('Sanitization discards arbitrary fields and no raw response bodies survive extraction', () => {
  const result=S.extract({password:'secret',cookies:'secret',video_url:'https://cdn.test/a.mp4',unknown:{token:'secret'}},'https://www.instagram.com');
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(S.clean({url:'javascript:alert(1)',kind:'video'},'https://x.com'),null);
});
test('Standard JSON-LD content URLs work on ordinary websites', () => {
  assert.equal(S.extract({'@type':'VideoObject',contentUrl:'https://cdn.example.org/a.mp4',name:'A video'},'https://example.org')[0].label,'A video');
});
