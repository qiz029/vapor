import test from 'node:test';
import assert from 'node:assert/strict';
import {renewMediaSource} from '../web/media-recovery.js';
class Media extends EventTarget{
 tagName='VIDEO';currentTime=12;duration=60;paused=true;ended=false;plays=0;_src='old';
 get src(){return this._src;}set src(v){this._src=v;this.currentTime=0;}
 async play(){this.plays++;}
}
test('renewal retains paused position and resumes only previously playing media',()=>{
 for(const paused of [true,false]){const media=new Media();media.paused=paused;renewMediaSource(media,'new');media.dispatchEvent(new Event('loadedmetadata'));assert.equal(media.currentTime,12);assert.equal(media.plays,paused?0:1);media.dispatchEvent(new Event('loadedmetadata'));assert.equal(media.plays,paused?0:1);}
});
test('renewal caps position for shorter media and leaves images without playback handlers',()=>{
 const media=new Media();media.duration=5;renewMediaSource(media,'new');media.dispatchEvent(new Event('loadedmetadata'));assert.equal(media.currentTime,5);
 const image={tagName:'IMG',src:'old'};renewMediaSource(image,'new');assert.equal(image.src,'new');
});
test('successive renewals before metadata preserve the original position once',()=>{const media=new Media();media.paused=false;renewMediaSource(media,'first');renewMediaSource(media,'second');media.dispatchEvent(new Event('loadedmetadata'));assert.equal(media.currentTime,12);assert.equal(media.plays,1);});
