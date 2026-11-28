# Deep render test of research/quai-live (see tools/quai-dashboard.md, "How to check changes").
# Usage: python3 tools/quai-deep-test.py <repo folder>   (needs: pip install playwright && playwright install chromium)
# Renders the page offline for 4 data scenarios (live-like, partial sources, extreme values, API down) x EN/RU x 7 widths
# and reports page errors, text artifacts (undefined/NaN/null/".."), horizontal overflow, clipped or spilling text and empty blocks.
import asyncio, json, datetime, copy, re, sys, os
SITE=os.path.abspath(sys.argv[1] if len(sys.argv)>1 else '.')
from playwright.async_api import async_playwright
snap=open(os.path.join(SITE,'assets','quai-dash.js'),encoding='utf-8').read(); BASE=json.loads(snap[snap.index('{'):snap.rindex('}')+1])
now=datetime.datetime.now(datetime.UTC); today=now.date()
def days(n,end=today): return [(end-datetime.timedelta(days=n-1-i)).isoformat() for i in range(n)]
def live():
    D=copy.deepcopy(BASE); D['updatedAt']=now.isoformat()
    d30=days(30); h=D['hashference']
    vals=[126,72,62,11,38,203,734,140,174,34,57,814,781,619,1579,602,712,867,914,795,1489,1570,2079,3349,543,918,785,1118,622,310]
    h.update(daily=[[d,v] for d,v in zip(d30,vals)], requests=sum(vals), measured=20795, series='received', updatedAt=now.isoformat(),
      history=[[d,0] for d in days(60,today-datetime.timedelta(days=30))]+[[d,v] for d,v in zip(d30,vals)],
      models=[['z-ai-glm-5-3-flash',7273,253907042,.188],['anthropic-claude-opus-5.5-messages',2333,245618444,.182],['deepseek-v4-1-flash-1017-uncensored',655,93401003,.069]],
      apps=[['Claude Code',5449,437286010,.32],['OpenAI SDK',4093,352969739,.26],['Hermes Agent',1,42992,.00003]],
      netDaily=[[d,5,(i*731)%20000,i%3] for i,d in enumerate(d30)], devicesConnected=4, shares30=251292)
    D['network']={'totalTx':None,'txToday':None,'gasToday':None,'addresses':None,'qiAddresses':277150}
    D['priceChart']=[[d,0.007] for d in days(120)]
    D['history']=[[d,{'p':.007,'du':2000,'dx':20000,'cov':.45,'r30':170000,'hst':3100000}] for d in days(7)]
    D['tokenomics']={'version':'t','updatedAt':'2026-11-27T16:00:00Z','affects':['unlock','supply','cov'],'issues':[],
      'forks':[{'id':'polaris','date':'2026-10-13','en':'Polaris fork: 236.5M QUAI of founder unlocks cancelled','ru':'Форк Polaris: отменено 236,5 млн QUAI разлоков основателей','url':'https://qu.ai/blog/introducing-the-polaris-fork'}]}
    return D
def partial():
    D=live(); 
    for k in ['hashference','dex','x402','soap']: D.pop(k,None)
    D['market'].update(vol24=None,ch24=None,ch7=None,ch30=None,ath=None,athDate=None,atl=None,atlDate=None,backup='explorer.qu.ai',tickers=[])
    D['hashferenceError']='down'; D['dexError']='down'
    return D
def extreme():
    D=live(); h=D['hashference']; h['daily']=[[d,0] for d in days(30)]; h['requests']=0; h['models']=[]; h['apps']=[]; h['netDaily']=[]
    D['market']['price']=123456.789; D['market']['depthUp']=0
    return D
import time as _t
_now=int(_t.time()); _A=lambda i:'0x'+('%040x'%i)
_M=lambda i,k,q,ex=None,fr=None,tr=None,gen=False,ago=3600:{'h':'0x%064x'%i,'t':_now-ago,'from':_A(i),'to':_A(i+1000),'q':q,'usd':round(q*0.0075),'kind':k,
   'fromEx':ex if k in('fromEx','exex') else None,'toEx':ex if k in('toEx','exex') else None,'fromRank':fr,'toRank':tr,'genesis':gen,'feed':q*0.0075>=6000}
WHALES={'updatedAt':now.isoformat(),'started':True,'week':{'toEx':{'q':5200000,'usd':39000,'n':3},'fromEx':{'q':2000000,'usd':15000,'n':1},'move':{'q':3500000,'usd':26250,'n':1}},
  'moves':[_M(1,'toEx',1200000,'Gate',15,None,True),_M(2,'toEx',2000000,'MEXC',3,ago=4000),_M(3,'toEx',2000000,'Gate',40,ago=4100),_M(4,'toEx',1500000,'Kraken',41,ago=4200),
   _M(5,'fromEx',2000000,'MEXC',None,7,ago=90000),_M(6,'move',3500000,None,9,None,ago=200000),_M(7,'exex',900000,'Gate',ago=300000)]+[_M(100+i,'move',300000,None,50+i,None,ago=400000+i*1000) for i in range(10)]}
SC={'live':live(),'partial':partial(),'extreme':extreme(),'down':None,'warnYel':live(),'warnRed':live()}
# tokenomics warning state (/api/quai-watch) per scenario; none = no warning
EV=lambda i,lvl,ru,en,url=None:{'id':'e%d'%i,'src':'blog','level':lvl,'ru':ru,'en':en,'url':url,'at':now.isoformat()}
WATCH={'warnYel':{'events':[EV(1,'yellow','Новая статья в блоге Quai: «introducing the vega fork»','New post on the Quai blog: "introducing the vega fork"','https://qu.ai/blog/x')],'level':'yellow','affects':['unlock','supply','cov']},
  'warnRed':{'events':[EV(2,'red','Разлок генезиса №22 (~3.7 млн QUAI, около 2026-11-30) не появился в предложении: пришло ~0.1 млн. Похоже, график разлоков изменился.','Genesis unlock #22 (~3.7M QUAI, around 2026-11-30) did not show up in the supply: only ~0.1M arrived. The unlock schedule seems to have changed.'),
     EV(3,'yellow','В документации Quai изменились цифры токеномики (quai-emissions): новые 1,100,000,000; убраны 1,332,840,016','Tokenomics numbers changed in the Quai docs (quai-emissions): new 1,100,000,000; removed 1,332,840,016','https://docs.qu.ai/x')],'level':'red','affects':['unlock','supply','cov']}}
BAD=re.compile(r'undefined|NaN|Infinity|\bnull\b|\[object|(?<!\.)\.\.(?!\.)|\{\{|\$-|−−|\s,\s')
async def check(pg):
    return await pg.evaluate(r"""(BAD)=>{const re=new RegExp(BAD); const out={};
      const txt=document.querySelector('main').innerText; const m=txt.match(new RegExp(BAD,'g')); out.artifacts=m?[...new Set(m)]:[];
      out.ctx=m?txt.slice(Math.max(0,txt.search(re)-60),txt.search(re)+60).replace(/\n/g,' | '):'';
      out.overflow=document.documentElement.scrollWidth>innerWidth;
      const clipped=[]; document.querySelectorAll('.tile .v,.dt .v,.vc .v,.tile .d,.dt .s,td,th,.sum,.ev .v,h1,h2,h3,.big2').forEach(e=>{ if(e.offsetParent&&(e.scrollWidth>e.clientWidth+2)) clipped.push((e.className||e.tagName)+':'+e.innerText.slice(0,30)); }); out.clipped=clipped.slice(0,6);
      const out2=[]; document.querySelectorAll('.tile,.dt,.vc,.panel').forEach(p=>{ const r=p.getBoundingClientRect(); p.querySelectorAll('*').forEach(c=>{ const q=c.getBoundingClientRect(); if(q.width&&q.right>r.right+2&&getComputedStyle(c).position!=='absolute'&&!c.closest('.tbl')) out2.push((c.className&&c.className.baseVal===undefined?c.className:c.tagName)+':'+(c.innerText||'').slice(0,20)); }); }); out.spill=[...new Set(out2)].slice(0,6);
      out.empty=['events','verdicts','summary','dynTiles','pulseTiles','priceChart','hfTiles','hfLong','hfModels','hfApps','hfShares','hfStake','supplyTiles','soapTiles','exTable','ecoTiles'].filter(id=>{const e=document.getElementById(id); return e&&e.offsetParent&&!e.innerHTML.trim();});
      const wh=document.getElementById('whales'); out.whales=wh&&wh.offsetParent?document.querySelectorAll('#whaleList .fe').length:-1;
      const bn=document.getElementById('tkBanner'); out.banner=bn&&!bn.hidden?bn.className+' marks='+document.querySelectorAll('.tkm').length:'';
      out.status=document.getElementById('status').innerText; return out;}""", BAD.pattern)
async def run():
    res=[]
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for sc,D in SC.items():
            for lang in ['ru','en']:
                for w in [360,390,768,1024,1280,1440,1920]:
                    pg=await b.new_page(viewport={'width':w,'height':900}); errs=[]
                    pg.on('pageerror', lambda e: errs.append('pageerror:'+str(e)))
                    body=json.dumps(D) if D else None
                    wbody=json.dumps(WATCH.get(sc,{'events':[],'level':None}))
                    whbody=json.dumps(WHALES if sc in ('live','warnRed') else {'moves':[],'started':sc!='partial','updatedAt':now.isoformat() if sc!='partial' else None,'week':{'toEx':{'q':0,'usd':0,'n':0},'fromEx':{'q':0,'usd':0,'n':0},'move':{'q':0,'usd':0,'n':0}}})
                    def mk(body,wbody,whbody):
                      async def route(r, req=None):
                        u=r.request.url
                        if '/api/quai-whales' in u: await (r.fulfill(status=200,body=whbody,content_type='application/json') if sc!='down' else r.fulfill(status=502,body='{}'))
                        elif '/api/quai-watch' in u: await r.fulfill(status=200,body=wbody,content_type='application/json')
                        elif '/api/quai' in u: await (r.fulfill(status=200,body=body,content_type='application/json') if body else r.fulfill(status=502,body='{}'))
                        elif u.startswith('http://site/'):
                            path=os.path.join(SITE,u[len('http://site/'):].split('?')[0])
                            if path.endswith(os.sep) or path.endswith('/'): path=os.path.join(path,'index.html')
                            await r.fulfill(path=path)
                        else: await r.abort()
                      return route
                    await pg.route('**/*', mk(body,wbody,whbody))
                    await pg.add_init_script("try{localStorage.clear();localStorage.setItem('qoge-lang','%s')}catch(e){}"%lang)
                    await pg.goto('http://site/research/quai-live/?lang='+lang); await pg.wait_for_timeout(1800)
                    c=await check(pg); c['errs']=errs
                    # tap an (i) tooltip on phones
                    if w<=390:
                        i=await pg.query_selector('[data-tip]')
                        if i: await i.click(); c['tip']=await pg.evaluate("getComputedStyle(document.querySelector('.tip')).opacity")
                    await pg.close()
                    bad={k:v for k,v in c.items() if v and k not in ('status','ctx','tip','banner','whales')}
                    if sc in ('live','warnRed') and c.get('whales',0)<12: bad['whales']='list %s'%c.get('whales')
                    if sc=='down' and c.get('whales',-1)!=-1: bad['whales']='shown while API down'
                    want=sc.startswith('warn')
                    if want and not c.get('banner'): bad['banner']='missing'
                    if not want and c.get('banner'): bad['banner']='unexpected: '+c['banner']
                    if want and c.get('banner') and ' marks=0' in c['banner']: bad['banner']='no tile marks'
                    res.append((sc,lang,w,bad,c.get('ctx'),c.get('tip'),c['status']))
        await b.close()
    return res
for r in asyncio.run(run()):
    sc,lang,w,bad,ctx,tip,st=r
    print(sc,lang,w,'OK' if not bad else bad, ('| ctx: '+ctx) if bad.get('artifacts') else '', ('tip='+str(tip)) if tip else '')
