"""List music capabilities and initialize explicit generation/experiment plans, offline."""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CATALOG={
 'minimax-2.6':{'status':'adapter-ready','template':'plan.json','runner':'tools/music/fal_generate.py','purpose':'Current music generation baseline'},
 'minimax-3':{'status':'adapter-ready-unverified-live','template':'music3-plan.json','runner':'tools/music/fal_generate.py','purpose':'Full song generation; compare Chinese diction and musical quality'},
 'ace-step-1.5':{'status':'experiment-plan-only','template':'ace-step-experiment.json','runner':None,'purpose':'Cover/repaint; preserve accepted sections while editing a phrase'},
 'vevo2':{'status':'experiment-plan-only','template':'vevo2-experiment.json','runner':None,'purpose':'Singing lyric/style editing; evaluate diction and source preservation'},
 'original-vs-converted':{'status':'experiment-plan-only','template':'vocal-ab-experiment.json','runner':None,'purpose':'Blind comparison of original singing versus converted and remixed singing'},
}
def initialize(option,out):
    template=ROOT/'examples/music'/CATALOG[option]['template']
    data=json.loads(template.read_text())
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('x') as f:json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n')
    return {'plan':str(out),'option':option,**CATALOG[option],'submitted':False}
def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    s.add_parser('list');i=s.add_parser('init');i.add_argument('option',choices=CATALOG);i.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    try:print(json.dumps(CATALOG if a.command=='list' else initialize(a.option,a.out),ensure_ascii=False,indent=2))
    except (ValueError,OSError) as error:p.exit(1,str(error)+'\n')
if __name__=='__main__':main()
