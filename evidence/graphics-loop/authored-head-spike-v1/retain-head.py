"""Retain CC0 face expressions and embed small textures; tooling is never shipped."""
import json,struct,math
from pathlib import Path
from PIL import Image
root=Path(__file__).parent
out=root/'generated';out.mkdir(exist_ok=True)
b=(root/'vitruvian_head.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);source=b[28+n:]
selected=['Happy','Smile_Lips_Closed','Jaw_Lower','Eyes_Closed_Max','Eyebrows_Raised_Left','Eyebrows_Raised_Right']
for mesh in g['meshes']:
 names=mesh.get('extras',{}).get('targetNames',[])
 if names:
  keep=[names.index(name) for name in selected]
  mesh['extras']['targetNames']=selected
  mesh['weights']=[0]*len(keep)
  for primitive in mesh['primitives']:primitive['targets']=[primitive['targets'][i] for i in keep]
 mesh['primitives']=[p for p in mesh['primitives'] if not g['materials'][p['material']]['name'].startswith('VitCornea')]
 for p in mesh['primitives']:
  p['attributes']={k:v for k,v in p['attributes'].items() if k in ['POSITION','NORMAL','TEXCOORD_0']}
# Omit optional static eyeshadow; all actual face/eyes and moving mouth remain.
g['scenes'][0]['nodes']=[i for i in g['scenes'][0]['nodes'] if not g['nodes'][i]['name'].startswith('Eyeshadow')]
used=set()
for m in g['meshes']:
 for p in m['primitives']:
  used.update(p['attributes'].values());used.add(p['indices'])
  for target in p.get('targets',[]):used.update(target.values())
new_accessors=[];new_views=[];chunks=[];length=0;amap={};vmap={}
def append(data):
 global length
 padded=data+b'\x00'*((-len(data))%4)
 index=len(new_views);new_views.append({'buffer':0,'byteOffset':length,'byteLength':len(data)});chunks.append(padded);length+=len(padded);return index
def view(index):
 if index not in vmap:
  old=g['bufferViews'][index];data=source[old.get('byteOffset',0):old.get('byteOffset',0)+old['byteLength']]
  vmap[index]=append(data)
  for k in ['byteStride','target']:
   if k in old:new_views[vmap[index]][k]=old[k]
 return vmap[index]
for index in sorted(used):
 a=g['accessors'][index].copy();amap[index]=len(new_accessors)
 if 'bufferView' in a:a['bufferView']=view(a['bufferView'])
 if 'sparse' in a:
  for part in ['indices','values']:a['sparse'][part]['bufferView']=view(a['sparse'][part]['bufferView'])
 new_accessors.append(a)
for mesh in g['meshes']:
 for p in mesh['primitives']:
  p['attributes']={k:amap[v] for k,v in p['attributes'].items()};p['indices']=amap[p['indices']]
  for target in p.get('targets',[]):
   for k in target:target[k]=amap[target[k]]
# UVs of the real mouth are in UDIM tile 1006; remap only that primitive to its tile.
mouth=g['meshes'][-1]['primitives'][1]
a=new_accessors[mouth['attributes']['TEXCOORD_0']];v=new_views[a['bufferView']]
data=bytearray(chunks[a['bufferView']]);stride=v.get('byteStride',8)
for i in range(a['count']):
 at=a.get('byteOffset',0)+i*stride;u,w=struct.unpack_from('<ff',data,at);struct.pack_into('<ff',data,at,u-5,w)
chunks[a['bufferView']]=bytes(data)
g['accessors']=new_accessors;g['bufferViews']=new_views
g['images']=[];g['textures']=[]
textures={}
for src,size,fmt in [('vit_face_bc.png',1024,'JPEG'),('vit_mouth.png',512,'JPEG'),('vit_iris.png',256,'JPEG'),('vit_sclera.png',256,'PNG')]:
 im=Image.open(root/src);im.thumbnail((size,size),Image.Resampling.LANCZOS)
 if fmt=='JPEG':im=im.convert('RGB')
 file=out/(Path(src).stem+('.jpg' if fmt=='JPEG' else '.png'));im.save(file,fmt,quality=88,optimize=True)
 vi=append(file.read_bytes());ix=len(g['images']);g['images'].append({'bufferView':vi,'mimeType':'image/jpeg' if fmt=='JPEG' else 'image/png'});textures[src]=len(g['textures']);g['textures'].append({'source':ix})
for material in g['materials']:
 name=material['name'];material['doubleSided']=False;p=material['pbrMetallicRoughness'];p['baseColorFactor']=[1,1,1,1];p['roughnessFactor']=0.65
 if name.startswith('VitSkin'):p['baseColorTexture']={'index':textures['vit_face_bc.png']}
 elif name.startswith('VitMouth'):p['baseColorTexture']={'index':textures['vit_mouth.png']}
 elif name.startswith('VitIris'):p['baseColorTexture']={'index':textures['vit_iris.png']};p['roughnessFactor']=0.3
 elif name.startswith('VitSclera'):p['baseColorTexture']={'index':textures['vit_sclera.png']};material['alphaMode']='BLEND';p['roughnessFactor']=0.25
 elif name.startswith('VitCornea'):p['baseColorFactor']=[1,1,1,0.12];p['roughnessFactor']=0.08;material['alphaMode']='BLEND'
 elif name.startswith('VitEyeBack'):p['baseColorFactor']=[0.008,0.006,0.005,1]
 elif name.startswith('VitTearline'):p['baseColorFactor']=[0.4,0.22,0.17,0.12];material['alphaMode']='BLEND';p['roughnessFactor']=0.1
 elif name.startswith('VitCaruncle'):p['baseColorFactor']=[0.45,0.18,0.13,1]
binary=b''.join(chunks);g['buffers']=[{'byteLength':len(binary)}]
j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
result=struct.pack('<III',0x46546c67,2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
(out/'expressive-head.glb').write_bytes(result)
(out/'asset-report.json').write_text(json.dumps({'sourceBytes':len(b),'retainedBytes':len(result),'retainedExpressions':selected,'textures':[{'path':p.name,'bytes':p.stat().st_size} for p in out.glob('*') if p.suffix in ['.png','.jpg']],'triangles':sum(g['accessors'][p['indices']]['count']//3 for m in g['meshes'] for p in m['primitives']),'note':'Head authoring experiment only. Not rig/wardrobe/game/mobile accepted.'},indent=2))
print((out/'asset-report.json').read_text())
