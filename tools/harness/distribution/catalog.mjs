/** Executable capability inventory. Every entry maps typed inputs to a fixed entrypoint. */
const text=(flag,extra={})=>({type:'string',minLength:1,maxLength:8000,flag,...extra});
const path=(flag,extra={})=>text(flag,{path:true,...extra});
const number=(flag,extra={})=>({type:'number',flag,...extra});
const boolean=flag=>({type:'boolean',flag});
const list=(flag,extra={})=>({type:'array',items:{type:'string'},maxItems:100,flag,...extra});
const project=path('--project');
const op=(id,script,command,fields={},required=[],extra={})=>({id,script,args:command?command.split(' '):[],fields,required,output:{flag:'--out',name:'result.json'},description:id.replaceAll('.',' '),...extra});
export const packs={
 'vapor-project':[
  ...['validate','snapshot','impact','fingerprint'].map(c=>op('project.'+c,'tools/project/project.py',c,{project,before:path('--before'),target:text('--target'),checks:list('--checks')},['project',...(c==='impact'?['before']:c==='fingerprint'?['target','checks']:[])])),
  op('project.register','tools/project/workflow.py','register',{project,source:path('--source'),id:text('--id'),kind:text('--kind'),producer:text('--producer',{enum:['media-assets','voice-production','video-production','video-style-extraction','cinematic-director','video-editing','music-generation']}),dependsOn:list('--depends-on'),origin:text('--origin')},['project','source','id','kind','producer','origin'],{output:null}),
  op('project.gate','tools/project/workflow.py','gate',{project,target:text('--target'),reviewer:text('--reviewer'),fullPlaybackReviewed:boolean('--full-playback-reviewed')},['project','target','reviewer','fullPlaybackReviewed'],{authority:'user'}),
  op('project.repair-plan','tools/project/workflow.py','repair-plan',{project,issues:path('--issues')},['project','issues']),
  op('project.apply-repair','tools/project/workflow.py','apply-repair',{project,plan:path('--plan'),asset:text('--asset'),source:path('--source'),origin:text('--origin')},['project','plan','asset','source','origin']),
  op('project.recheck','tools/project/workflow.py','recheck',{project,plan:path('--plan')},['project','plan'])
 ],
 'vapor-audio':[
  op('audio.assemble','tools/audio/timeline.py','assemble',{manifest:path('--manifest')},['manifest'],{output:{flag:'--out',name:'audio.wav'}}),
  ...['verify','mux'].map(c=>op('audio.'+c,'tools/audio/timeline.py',c,{video:path('--video'),expected:path('--expected')},['video','expected'],{output:{flag:'--out',name:c==='mux'?'final.mp4':'result.json'}})),
  op('audio.mix','tools/audio/mix.py','mix',{project,manifest:path('--manifest'),id:text('--id')},['project','manifest'],{output:{flag:'--out',name:'output'}}),
  op('audio.check','tools/audio/mix.py','check',{audio:path('--audio')},['audio'])
 ],
 'vapor-captions':[
  op('captions.align','tools/captions/align.py','',{project,audio:path('--audio'),alignment:path('--alignment'),audioAsset:text('--audio-asset'),id:text('--id')},['project','audio','alignment','audioAsset'],{output:{flag:'--out',name:'output'}}),
  op('transcript.import','tools/video/editing/transcripts.py','import',{project,source:text('--source'),id:text('--id'),input:path('--input'),origin:text('--origin'),audioTrack:number('--audio-track',{type:'integer',minimum:0})},['project','source','id','input','origin'],{output:null}),
  op('transcript.pack','tools/video/editing/transcripts.py','pack',{project,transcripts:list('--transcripts')},['project','transcripts'],{output:{flag:'--out',name:'transcripts.md'}}),
  op('transcript.scribe','tools/video/editing/transcripts.py','cloud',{project,source:text('--source'),id:text('--id'),audioTrack:number('--audio-track',{type:'integer',minimum:0}),language:text('--language')},['project','source','id'],{output:null,remote:'metered',provider:'elevenlabs',approvalArgs:['--allow-upload'],budgetArgs:true,timeout:1900000})
 ],
 'vapor-editing':[
  ...['validate','render'].map(c=>op('editing.'+c,'tools/video/editing/edit.py',c,{project,edl:path('--edl'),draft:boolean('--draft')},['project','edl'],{output:c==='validate'?null:{flag:'--out',name:'output'}})),
  op('editing.view','tools/video/editing/edit.py','view',{project,asset:text('--asset'),start:number('--start',{minimum:0}),end:number('--end',{minimum:0}),transcript:text('--transcript')},['project','asset','start','end'],{output:{flag:'--out',name:'output'}}),
  op('video.finalize','tools/video/finalize.py','',{project,picture:path('--picture'),audio:path('--audio'),alignment:path('--alignment'),pictureAsset:text('--picture-asset'),audioAsset:text('--audio-asset'),captionsAsset:text('--captions-asset'),id:text('--id')},['project','picture','audio','alignment','pictureAsset','audioAsset'],{output:{flag:'--out',name:'output'}}),
  op('video.import-timeline','tools/video/import_timeline.py','',{timeline:path('--timeline'),audio:path('--audio'),title:text('--title')},['timeline','audio','title'],{output:{flag:'--output',name:'manifest.json'}})
 ],
 'vapor-remotion':[
  ...['validate','render','still'].map(c=>op('remotion.'+c,'tools/video/remotion/cli.ts',c,{manifest:path('--manifest'),frame:number('--frame',{type:'integer',minimum:0})},['manifest'],{engine:'node',output:c==='validate'?null:{flag:'--out',name:'output'}})),
  ...['music-video','kinetic-mv','lyric-driven-mv','editorial-mv','chorus-editorial'].map(style=>op('remotion.'+style,'tools/video/remotion/render-mv.ts','',{manifest:path(null),mode:text(null,{enum:['render','still']}),frame:number(null,{type:'integer',minimum:0})},['manifest'],{engine:'node',mv:style,output:{name:'output'}})),
  op('video.animatic','tools/video/animatic.py','',{project,plan:path('--plan'),prepareOnly:boolean('--prepare-only')},['project','plan'],{output:{flag:'--out',name:'output'}})
 ],
 'vapor-images':[
  op('image.import','tools/images/import_asset.py','',{source:path('--source'),promptFile:path('--prompt-file'),provider:text('--provider'),model:text('--model')},['source','promptFile','provider'],{output:{flag:'--output',name:'output'}})
 ],
 'vapor-review':[
  op('review.evidence','tools/video/review_evidence.py','',{video:path('--video'),ranges:list('--range',{repeat:true,minItems:1})},['video','ranges'],{output:{flag:'--out',name:'output'}}),
  op('review.style-samples','tools/video/style_samples.py','',{video:path('--video'),times:{type:'array',items:{type:'number'},flag:'--time',repeat:true,maxItems:100},clips:list('--clip',{repeat:true}),autoCount:number('--auto-count',{type:'integer',minimum:1,maximum:100}),columns:number('--columns',{type:'integer',minimum:1,maximum:10})},['video'],{output:{flag:'--out',name:'output'}})
 ],
 'vapor-review-gemini':[
  op('gemini.video-review','tools/video/vlm_review.py','',{video:path('--video'),contract:path('--contract'),processing:text('--processing',{enum:['static','agentic']}),fps:number('--fps',{minimum:.1,maximum:30})},['video','contract'],{remote:'metered',provider:'gemini',output:{flag:'--out',name:'output'}}),
  op('gemini.style-extract','tools/video/vlm_style_extract.py','',{video:path('--video'),manifest:path('--manifest'),title:text('--title'),referenceUrl:text('--reference-url'),brief:text('--brief'),processing:text('--processing',{enum:['static','agentic']}),fps:number('--fps',{minimum:.1,maximum:30})},['video','title'],{remote:'metered',provider:'gemini',output:{flag:'--out',name:'output'}}),
  op('gemini.music-review','tools/music/gemini_review.py','',{audio:path('--audio')},['audio'],{remote:'metered',provider:'gemini',output:{flag:'--out',name:'output'}})
 ],
 'vapor-music':[
  op('music.options','tools/music/options.py','list',{},[],{output:null}),
  op('music.init','tools/music/options.py','init',{option:text(null,{enum:['minimax-2.6','minimax-3','ace-step-1.5','vevo2','original-vs-converted']})},['option'],{positional:['option']}),
  op('music.generate','tools/music/fal_generate.py','',{plan:path('--plan')},['plan'],{remote:'ledger',provider:'fal-music',dryArgs:['--dry-run'],approvalArgs:['--allow-paid'],output:{flag:'--out',ledger:true},recovery:['run','status','reconcile','settle']})
 ],
 'vapor-generation-fal':[
  ...[['minimax-h3','tools/video/fal_generate.py'],['seedance','tools/video/fal_seedance_generate.py'],['seedance25','tools/video/fal_seedance25_generate.py']].map(([name,script])=>op('video.generate-'+name,script,'',{plan:path('--plan')},['plan'],{remote:'ledger',provider:'fal-video',dryArgs:['--dry-run'],output:{flag:'--out',ledger:true},recovery:['run','status','reconcile','settle']}))
 ],
 'vapor-gpu-modal':[
  op('gpu.execute','tools/gpu/modal_jobs.py','run',{plan:path('--plan')},['plan'],{remote:'ledger',provider:'modal',dryArgs:['plan'],dryReplace:true,approvalArgs:['--allow-paid'],output:{flag:'--out',ledger:true},recovery:['run','status','reconcile','settle','mark-terminal']})
 ],
 'vapor-costs':[
  op('costs.report','tools/costs/report.py','',{manifest:path('--manifest')},['manifest'],{output:{flag:'--out',name:'output'}})
 ],
 'vapor-regression':[
  op('regression.run','tools/regression/run.py','run',{},[],{output:{flag:'--out',name:'output'}}),
  op('regression.compare','tools/regression/run.py','compare',{before:path('--before'),after:path('--after')},['before','after']),
  op('regression.annotate','tools/regression/run.py','annotate',{report:path('--report'),annotations:path('--annotations')},['report','annotations'],{authority:'user'})
 ],
 'vapor-motion-viggle':[
  op('motion.doctor','tools/motion/viggle.py','doctor',{},[],{output:null}),
  op('motion.credits','tools/motion/viggle.py','credits',{},[],{output:null,remote:'download',provider:'viggle'}),
  op('motion.plan','tools/motion/viggle.py','plan',{kind:text('--kind',{enum:['remix','mocap']}),video:path('--video'),image:path('--image'),budgetUSD:number('--budget-usd',{minimum:.001})},['kind','video','budgetUSD']),
  op('motion.submit','tools/motion/viggle.py','submit',{plan:path('--plan'),skeleton:text(null,{enum:['mixamo','metahuman']})},['plan'],{remote:'viggle',provider:'viggle',output:{flag:'--out',name:'output'},recovery:['run','status','reconcile','settle','mark-terminal']})
 ],
 'vapor-voice-local':[
  ...['doctor','list'].map(c=>op('voice.'+c,'tools/voice/voice.py',c,{},[],{output:null})),
  op('voice.add','tools/voice/voice.py','add',{name:text(null,{pattern:'^[A-Za-z0-9_-]+$'}),source:path('--source'),transcript:text('--transcript'),start:number('--start',{minimum:0}),duration:number('--duration',{minimum:3,maximum:30}),language:text('--language'),sourceNote:text('--source-note'),separation:text('--separation',{enum:['demucs','none']})},['name','source','transcript','sourceNote'],{positional:['name'],output:null}),
  op('voice.speak','tools/voice/voice.py','speak',{name:text(null,{pattern:'^[A-Za-z0-9_-]+$'}),textFile:path('--text-file'),seed:number('--seed',{type:'integer',minimum:0})},['name','textFile'],{positional:['name'],output:{flag:'--output',name:'speech.wav'}}),
  op('voice.prepare-model','tools/voice/prepare_model.py','',{},[],{remote:'download',provider:'huggingface',output:null,timeout:3600000})
 ]
};
export const optionalPacks=['vapor-voice-local','vapor-review-gemini'];
export const sharedPython=['tools/project/project.py','tools/project/workflow.py','tools/video/job_store.py','tools/audio/timeline.py','tools/captions/align.py','tools/video/editing/common.py','tools/video/editing/edit.py','tools/video/editing/evidence.py','tools/video/fal_generate.py','tools/gpu/worker.py','tools/video/vlm_review.py'];
