"""Hand-authored, isolated fixtures for the independent regional fan-out audit."""
from __future__ import annotations
import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path
SCRIPT=Path(__file__).with_name('verify_regional_fanout.py')
def canonical(v):
    # Fixture values avoid JS/Python float-format edge cases; verifier tests those separately.
    return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def body(v):return (canonical(v)+'\n').encode()
def sha(b):return hashlib.sha256(b.encode() if isinstance(b,str) else b).hexdigest()
def write(root,rel,data):
    p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);return p
class FanoutVerifierTests(unittest.TestCase):
 def fixture(self, root:Path):
    region={'id':'cell-a','parentId':'unit-a','name':'Cell A','kind':'cell','countryCode':'GH','timezone':'Africa/Accra','bounds':[0,0,2,2]}
    source_feature={'type':'Feature','id':'road-1','properties':{'highway':'local'},'geometry':{'type':'LineString','coordinates':[[0.5,0.5],[1.5,1.5]]}}
    geo={'type':'FeatureCollection','metadata':{'producer':'fixture'},'features':[source_feature]}; raw=body(geo); source={'id':'fixture-source','url':'https://example.test/data','release':'fixture-v1','license':'fixture','attribution':'fixture','sha256':sha(raw),'bytes':len(raw)}
    write(root,'.cache/world-build/parent.geojson',raw)
    request={'schemaVersion':1,'id':'req-a','inventoryHash':'a'*64,'inventoryUnitId':'unit-a','parentPlan':{'region':region,'source':source,'input':{'path':'.cache/world-build/parent.geojson','sha256':sha(raw),'bytes':len(raw)}},'parentAcquisition':None,'children':[region],'limits':{'inputBytes':100000,'features':20,'coordinates':100,'children':4,'outputBytes':100000}}
    rh=sha(canonical(request)); key='fixture-source:road-1'; fh=sha(canonical(source_feature).encode()); bounds=[0.5,0.5,1.5,1.5]
    row={'key':key,'featureId':'road-1','featureSha256':fh,'sourceOrdinals':[0],'kind':'road','partIds':[key+'/road/0'],'ownerPoint':[0.5,0.5],'ownerCellId':'cell-a','status':'owned','bounds':bounds,'touchingCellIds':['cell-a']}
    childgeo={'type':'FeatureCollection','metadata':{'producer':'fixture','regionalFanout':{'requestHash':rh,'parentInputSha256':sha(raw),'logicalCellId':'cell-a','ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1'}},'features':[source_feature]}
    cb=body(childgeo); cref={'path':'inputs/'+sha(cb)+'.geojson','sha256':sha(cb),'bytes':len(cb)};write(root,'output/fanout/'+cref['path'],cb)
    childsource={**source,'sha256':sha(cb),'bytes':len(cb)}; plan={'region':region,'source':childsource,'input':cref}
    cell={'region':region,'status':'owned-features','ownedFeatureKeys':[key],'touchingFeatureKeys':[key],'ownerDependencies':[],'unresolvedFeatureKeys':[],'input':cref,'plan':plan}
    index={'schemaVersion':1,'compilerVersion':'regional-whole-feature-fanout-v1','requestHash':rh,'request':request,'coverage':'foundation','ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1','intersection':'conservative-feature-bounds','features':[row],'cells':[cell],'counts':{'sourceRows':1,'uniqueFeatures':1,'duplicateRows':0,'owned':1,'outsideDenominator':0,'unsupported':0,'emittedParts':1,'coordinates':2},'limitations':['Fixture limitation']}
    ib=body(index); ih=sha(ib); path='output/fanout/indices/'+ih+'.json';write(root,path,ib)
    receipt={'schemaVersion':1,'requestHash':rh,'indexHash':ih,'indexPath':'indices/'+ih+'.json','logicalBytes':len(ib)+len(cb),'inputs':[cref]};write(root,'output/fanout/publications/'+rh+'.json',body(receipt))
    return path,ih,index,source_feature
 def fixture_acquired(self,root:Path,bad_source_url=False):
    path,_,index,feature=self.fixture(root);req=index['request'];region=req['parentPlan']['region'];acq_hash='b'*64;timestamp='2026-10-08T12:00:00.000Z';release='2026-09-23.1';attribution='Overture Maps Foundation attribution https://docs.overturemaps.org/attribution/'
    layer={'id':f'overture-{release}-roads','url':f'https://stac.overturemaps.org/{release}/transportation/segment/collection.json','release':release,'license':'ODbL-1.0','attribution':attribution,'sha256':'c'*64,'bytes':123}
    if bad_source_url:layer['url']='https://example.test/roads.json'
    acquisition_request={'schemaVersion':1,'id':'acq-fixture','inventoryUnitId':req['inventoryUnitId'],'region':region,'provider':'overture','release':release,'layers':['roads'],'limits':{'outputBytes':100000}}
    selection={k:acquisition_request[k] for k in ('schemaVersion','id','inventoryUnitId','region','provider','release','layers')}
    receipt={'schemaVersion':1,'requestHash':acq_hash,'selection':selection,'request':acquisition_request,'completedAt':timestamp,'inputSha256':'','inputBytes':0,'metrics':{},'upstream':[],'sources':[layer],'exceptions':[]}
    geo={'type':'FeatureCollection','metadata':{'producer':'fixture','requestHash':acq_hash},'features':[feature]};raw=body(geo);geo_sha=sha(raw);receipt['inputSha256']=geo_sha;receipt['inputBytes']=len(raw);write(root,req['parentPlan']['input']['path'],raw)
    src={'id':f'overture-{release}-roads','url':f'https://stac.overturemaps.org/{release}/catalog.json','release':release,'license':'ODbL-1.0','attribution':attribution,'sha256':geo_sha,'bytes':len(raw)}
    req['parentPlan']['source']=src;req['parentPlan']['input']={'path':'.cache/world-build/parent.geojson','sha256':geo_sha,'bytes':len(raw)};req['parentPlan']['rawExtraction']={'url':f'overture:{release}/{acq_hash}','fetched':timestamp,'sha256':geo_sha,'bytes':len(raw)}
    receipt_raw=body(receipt);write(root,'receipt.json',receipt_raw);req['parentAcquisition']={'requestHash':acq_hash,'receipt':{'path':'receipt.json','sha256':sha(receipt_raw),'bytes':len(receipt_raw)}}
    rh=sha(canonical(req));index['request']=req;index['requestHash']=rh;newkey=f"{src['id']}:road-1";index['features'][0]['key']=newkey;index['features'][0]['partIds']=[newkey+'/road/0'];index['cells'][0]['ownedFeatureKeys']=[newkey];index['cells'][0]['touchingFeatureKeys']=[newkey];cell=index['cells'][0];meta={'producer':'fixture','requestHash':acq_hash,'regionalFanout':{'requestHash':rh,'parentInputSha256':geo_sha,'logicalCellId':'cell-a','ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1'}};collection={'type':'FeatureCollection','metadata':meta,'features':[feature]};cb=body(collection);ch=sha(cb);ref={'path':f'inputs/{ch}.geojson','sha256':ch,'bytes':len(cb)};write(root,'output/fanout/'+ref['path'],cb);cell['input']=ref;cell['plan']['input']=ref;cell['plan']['source']={**src,'sha256':ch,'bytes':len(cb)};cell['plan']['rawExtraction']=req['parentPlan']['rawExtraction']
    ib=body(index);ih=sha(ib);path=f'output/fanout/indices/{ih}.json';write(root,path,ib);publication={'schemaVersion':1,'requestHash':rh,'indexHash':ih,'indexPath':f'indices/{ih}.json','logicalBytes':len(ib)+len(cb),'inputs':[ref]};write(root,f'output/fanout/publications/{rh}.json',body(publication));return path,ih,index
 def fixture_split(self,root:Path):
    path,_,index,feature=self.fixture(root);req=index['request'];region_a=dict(req['children'][0]);region_b=dict(region_a);region_a['bounds']=[0,0,1,2];region_b.update(id='cell-b',name='Cell B',bounds=[1,0,2,2]);req['children']=[region_a,region_b];rh=sha(canonical(req));key='fixture-source:road-1';index['requestHash']=rh;index['request']=req
    index['features'][0]['touchingCellIds']=['cell-a','cell-b']
    cells=[]
    for region,owned,deps,plan_bounds in ((region_a,[feature],[],[0,0,1.5,2]),(region_b,[],['cell-a'],[1,0,2,2])):
     cid=region['id'];collection={'type':'FeatureCollection','metadata':{'producer':'fixture','regionalFanout':{'requestHash':rh,'parentInputSha256':req['parentPlan']['input']['sha256'],'logicalCellId':cid,'ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1'}},'features':owned};cb=body(collection);sh=sha(cb);ref={'path':'inputs/'+sh+'.geojson','sha256':sh,'bytes':len(cb)};write(root,'output/fanout/'+ref['path'],cb);source={**req['parentPlan']['source'],'sha256':sh,'bytes':len(cb)};plan={'region':{**region,'bounds':plan_bounds},'source':source,'input':ref};cells.append({'region':region,'status':'owned-features' if owned else 'empty-owned','ownedFeatureKeys':[key] if owned else [],'touchingFeatureKeys':[key],'ownerDependencies':deps,'unresolvedFeatureKeys':[],'input':ref,'plan':plan})
    index['cells']=cells;old_body=body(index);old_hash=sha(old_body);index['counts'].update(sourceRows=1,uniqueFeatures=1,duplicateRows=0,owned=1,outsideDenominator=0,unsupported=0,emittedParts=1,coordinates=2);ib=body(index);ih=sha(ib);path='output/fanout/indices/'+ih+'.json';write(root,path,ib);receipt={'schemaVersion':1,'requestHash':rh,'indexHash':ih,'indexPath':'indices/'+ih+'.json','logicalBytes':len(ib)+sum(c['input']['bytes'] for c in cells),'inputs':[c['input'] for c in cells]};write(root,'output/fanout/publications/'+rh+'.json',body(receipt));return path,ih,index
 def run_cli(self,root,path,ih):return subprocess.run([sys.executable,str(SCRIPT),'--root',str(root.resolve()),'--index-path',path,'--index-hash',ih],capture_output=True,text=True,timeout=5)
 def test_valid_hand_authored_source_membership_and_canonical_feature_hash(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,_,_=self.fixture(root);result=self.run_cli(root,path,ih)
     self.assertEqual(result.returncode,0,result.stderr);receipt=json.loads(result.stdout);self.assertEqual((receipt['sourceRows'],receipt['owned'],receipt['emittedParts'],receipt['networkBytes'],receipt['diskBytes']),(1,1,1,0,receipt['logicalBytes']+receipt['publicationBytes']))
 def test_rehashed_wrong_owner_row_is_rejected(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,_,idx,_=self.fixture(root);idx['features'][0]['ownerCellId']='cell-forged';raw=body(idx);path=str(Path(path).parent/(sha(raw)+'.json'));write(root,path,raw);r=self.run_cli(root,path,sha(raw));self.assertNotEqual(r.returncode,0);self.assertIn('feature rows differ',r.stderr)
 def test_rehashed_missing_source_row_is_rejected(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,_,idx,_=self.fixture(root);idx['features']=[];raw=body(idx);path=str(Path(path).parent/(sha(raw)+'.json'));write(root,path,raw);r=self.run_cli(root,path,sha(raw));self.assertNotEqual(r.returncode,0);self.assertIn('feature rows differ',r.stderr)
 def test_changed_child_coordinates_even_with_new_child_hash_is_rejected(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,_,idx,feature=self.fixture(root);cell=idx['cells'][0];cref=cell['input'];child={'type':'FeatureCollection','metadata':{'producer':'fixture','regionalFanout':{'requestHash':idx['requestHash'],'parentInputSha256':idx['request']['parentPlan']['input']['sha256'],'logicalCellId':'cell-a','ownership':'lexicographic-source-vertex-closed-cell-id-tie-v1'}},'features':[json.loads(json.dumps(feature))]};child['features'][0]['geometry']['coordinates'][0]=[0.6,0.5];cb=body(child);newsha=sha(cb);newpath='inputs/'+newsha+'.geojson';write(root,'output/fanout/'+newpath,cb);cref.update(path=newpath,sha256=newsha,bytes=len(cb));cell['plan']['input']=cref;cell['plan']['source'].update(sha256=newsha,bytes=len(cb));raw=body(idx);path=str(Path(path).parent/(sha(raw)+'.json'));write(root,path,raw);r=self.run_cli(root,path,sha(raw));self.assertNotEqual(r.returncode,0);self.assertIn('exact whole owned',r.stderr)
 def test_rehashed_publication_with_wrong_logical_bytes_is_rejected(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,index,_=self.fixture(root);pub=root/'output/fanout/publications'/f"{index['requestHash']}.json";record=json.loads(pub.read_bytes());record['logicalBytes']+=1;pub.write_bytes(body(record));result=self.run_cli(root,path,ih);self.assertNotEqual(result.returncode,0);self.assertIn('completion publication receipt',result.stderr)
 def test_overture_acquisition_layers_bind_combined_source_and_metadata(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,_=self.fixture_acquired(root);result=self.run_cli(root,path,ih);self.assertEqual(result.returncode,0,result.stderr)
 def test_forged_overture_layer_url_is_rejected_even_when_receipt_is_rehashed(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,_=self.fixture_acquired(root,bad_source_url=True);result=self.run_cli(root,path,ih);self.assertNotEqual(result.returncode,0);self.assertIn('not a pinned Overture layer',result.stderr)
 def test_owner_dependencies_are_neighbor_cell_ids_not_feature_keys(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,index=self.fixture_split(root);result=self.run_cli(root,path,ih);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(index['cells'][1]['ownerDependencies'],['cell-a'])
 def test_missing_completion_receipt_rejects_incomplete_publication(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,ih,idx,_=self.fixture(root);(root/'output/fanout/publications'/f"{idx['requestHash']}.json").unlink();result=self.run_cli(root,path,ih);self.assertNotEqual(result.returncode,0);self.assertIn('No such file',result.stderr)
 def test_symlinked_child_asset_is_refused(self):
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as outside:
     root=Path(td);path,ih,idx,_=self.fixture(root);ref=idx['cells'][0]['input'];asset=root/'output/fanout'/ref['path'];asset.unlink();target=Path(outside)/'payload';target.write_bytes(b'not the child');asset.symlink_to(target);result=self.run_cli(root,path,ih);self.assertNotEqual(result.returncode,0);self.assertIn('symlink',result.stderr)
 def test_parent_input_hash_is_checked_before_accepting_rehashed_index(self):
    with tempfile.TemporaryDirectory() as td:
     root=Path(td);path,_,idx,_=self.fixture(root);raw_path=root/idx['request']['parentPlan']['input']['path'];raw_path.write_bytes(raw_path.read_bytes()+b' ');body_bytes=body(idx);path=str(Path(path).parent/(sha(body_bytes)+'.json'));write(root,path,body_bytes);result=self.run_cli(root,path,sha(body_bytes));self.assertNotEqual(result.returncode,0);self.assertIn('parent GeoJSON bytes differ',result.stderr)
 def test_javascript_number_spellings_match_ecmascript_boundaries(self):
    sys.path.insert(0,str(SCRIPT.parent));import verify_regional_fanout as v
    values={0.000123:'0.000123',1e-6:'0.000001',1e-7:'1e-7',1e20:'100000000000000000000',1e21:'1e+21',-0.0:'0',1.234e-10:'1.234e-10',14.717778:'14.717778'}
    for value,expected in values.items():self.assertEqual(v.js_number(value),expected)
    self.assertEqual(v.wrapped(-17.475076),-17.475076)
    self.assertEqual(v.canonical({'10':'ten','2':'two','a':0.000123}),'{\"2\":\"two\",\"10\":\"ten\",\"a\":0.000123}')
if __name__=='__main__':unittest.main()
