import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { cameraCorners, documentField, inspectFrame, parseProject } from '../dist/index.js'
import { projectPoint } from '../dist/shared/cameraGeometry.js'
import { compileTimeline } from '../dist/pipeline/timeline.js'

const read = name => JSON.parse(fs.readFileSync(new URL('../playground/' + name, import.meta.url),'utf8'))

test('inverse camera corners support roll, zoom and world Y sign', () => {
  const m = [0,2,-2,0,10,-20]
  const corners = cameraCorners(m,1920,1080)
  assert.deepEqual(corners[0].px,[10,5])
  assert.deepEqual(corners[1].px,[10,-955])
  assert.deepEqual(corners[0].u,[(10-960)/1080,(540-5)/1080])
  assert.deepEqual(corners.map(c=>projectPoint(m,c.px)),[[0,0],[1920,0],[1920,1080],[0,1080]])
})

test('compiled cue metadata uses the actual interrupted value and current phase', () => {
  const doc = read('topology-flow.scene.json')
  doc.camera = { ...doc.camera, zoom: 1 }; delete doc.camera.view3d; delete doc.camera.position
  doc.cues = [
    {target:'camera', property:'zoom', at:'first', to:2, duration:2},
    {target:'camera', property:'zoom', at:'next', to:1, duration:1},
  ]
  const timeline = compileTimeline(parseProject(doc),new Map([['first',0],['next',1]]))
  const current = timeline.cuesAt(1.5)[0]
  assert.deepEqual([current.at,current.from,current.to,current.p,current.running],['next',1.5,1,0.5,true])
  assert.equal(timeline.cuesAt(3)[0].running,false)
  assert.equal(timeline.cameraAt(1.5)[0],1.25)
})

test('frame inspection keeps raw matrix, resolved boxes and measurements from the prepared project', () => {
  const raw = read('topology-flow.scene.json')
  raw.elements.push({id:'poster-image',kind:'image',src:'./poster.svg',fit:'contain',layout:{region:'world',x:0,y:0,anchor:[0,0],width:0.3}})
  const doc = parseProject(raw)
  const definition = doc.elements.find(p=>p.id==='poster-image')
  const box={x:760,y:460,width:300,height:210}
  const scene={canvas:doc.canvas,camera:[1,0,0,1,0,0],
    primitives:[{id:'poster-image',kind:'image',rect:box,src:definition.src,fit:'contain'}]}
  const prepared={document:doc,boxes:new Map([['poster-image',box]]),measurement:new Map([['poster-image',{width:920,height:500}]]),
    renderAt:()=>scene,cuesAt:()=>[]}
  const data=inspectFrame(prepared,0)
  assert.equal(data.camera.matrix,scene.camera)
  assert.equal(data.elements[0].box,box)
  assert.deepEqual(data.elements[0].anchor.px,[910,565])
  assert.deepEqual(data.elements[0].anchor.u,[-50/1080,-25/1080])
  assert.deepEqual(data.camera.target,{px:[960,540],u:[0,0]})
  assert.deepEqual(data.elements[0].measurement,{width:920,height:500})
  assert.equal(data.camera.pan_px,0)
})

test('numeric field editing clones the source and rejects nonnumeric properties', () => {
  const source=read('topology-flow.scene.json')
  const i=source.elements.findIndex(e=>e.id==='paper'), c=source.cues.findIndex(q=>q.property==='text')
  const result=documentField(source,'elements.'+i+'.layout.width','70%')
  assert.equal(result.elements[i].layout.width,'70%')
  assert.notEqual(source.elements[i].layout.width,'70%')
  assert.throws(()=>documentField(source,'elements.'+i+'.src','0'))
  assert.throws(()=>documentField(source,'cues.'+c+'.to','9'))
})
