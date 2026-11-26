import * as THREE from 'three';
import { RULES } from './rules.ts';

export type Quality = 'low' | 'medium' | 'high';

export function waveHeight(x: number, z: number, t: number) {
  return Math.sin(x * 0.055 + t * 0.9) * 0.55
    + Math.sin(z * 0.078 - t * 1.1) * 0.42
    + Math.sin((x + z) * 0.032 + t * 0.6) * 0.35;
}

function canvasTexture(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function sailTexture() {
  return canvasTexture((c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#fff6df'); g.addColorStop(0.5, '#f3e6c8'); g.addColorStop(1, '#e8d6b1');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(146,111,63,.45)'; c.lineWidth = 3;
    c.strokeRect(10, 10, w - 20, h - 20);
    for (let i = 1; i < 6; i++) {
      c.beginPath(); c.moveTo(i * w / 6, 0); c.lineTo(i * w / 6, h); c.stroke();
    }
    // 小巧精致的 LSY 徽记
    // 略偏左，避免被桅杆遮住
    const cx = w * 0.30, cy = h / 2;
    c.save(); c.translate(cx, cy);
    c.beginPath(); c.arc(0, -8, 34, 0, Math.PI * 2);
    c.strokeStyle = '#b7863c'; c.lineWidth = 4; c.stroke();
    c.beginPath(); c.moveTo(-26, 12); c.quadraticCurveTo(-12, 2, 0, 12); c.quadraticCurveTo(12, 22, 26, 12);
    c.strokeStyle = '#2d7f8c'; c.lineWidth = 5; c.stroke();
    c.fillStyle = '#1e5b68'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 34px Georgia, serif'; c.fillText('LSY', 0, -10);
    c.restore();
  }, 256, 512);
}

function woodTexture() {
  return canvasTexture((c, w, h) => {
    c.fillStyle = '#7b5230'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * h;
      c.strokeStyle = `rgba(${30 + Math.random() * 40},${18 + Math.random() * 25},8,${0.08 + Math.random() * 0.18})`;
      c.lineWidth = 1 + Math.random() * 3;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * .3, y + Math.random() * 8 - 4, w * .7, y + Math.random() * 8 - 4, w, y); c.stroke();
    }
  }, 256, 256);
}

function softTexture(color: string) {
  return canvasTexture((c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.35, color.replace('1)', '.55)'));
    g.addColorStop(1, color.replace('1)', '0)'));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, 128, 128);
}

function cloudTexture() {
  return canvasTexture((c, w, h) => {
    for (let i = 0; i < 9; i++) {
      const x = 30 + Math.random() * (w - 60), y = h * .45 + Math.random() * 22;
      const r = 28 + Math.random() * 42;
      const g = c.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  }, 256, 128);
}

interface Particle { sprite: THREE.Sprite; life: number; max: number; vx: number; vy: number; vz: number; scale: number; kind: string }

export class OceanScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.5, 2000);
  renderer: THREE.WebGLRenderer;
  private water!: THREE.Mesh;
  private waterMat!: THREE.ShaderMaterial;
  private ships = new Map<string, THREE.Group>();
  private wakes = new Map<string, Particle[]>();
  private chests: THREE.Group[] = [];
  private particles: Particle[] = [];
  private cloudGroup = new THREE.Group();
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camPos = new THREE.Vector3(0, 40, -60);
  private sailTex = sailTexture();
  private woodTex = woodTexture();
  private tex = {
    smoke: softTexture('rgba(210,205,190,1)'),
    flash: softTexture('rgba(255,206,110,1)'),
    splash: softTexture('rgba(220,245,245,1)'),
    fire: softTexture('rgba(255,122,52,1)'),
    gold: softTexture('rgba(255,222,138,1)')
  };
  private cloudTex = cloudTexture();
  private texQuality: Quality;
  private menuShip: THREE.Group;
  private menuAngle = 0;
  menuMode = true;
  playerId = '';
  private clockT = 0;
  private resizeObserver?: ResizeObserver;

  constructor(private container: HTMLElement, quality: Quality) {
    this.texQuality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    this.container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(0x8fb9bc, 0.0022);
    this.buildSky();
    this.buildLights();
    this.buildWater();
    this.buildIslands();
    this.buildClouds();
    this.menuShip = this.makeShip(0xe8a95b, 'LSY');
    this.scene.add(this.menuShip);
    this.buildChests();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        varying vec3 vP; uniform float uTime;
        void main(){
          float h=normalize(vP).y;
          vec3 top=vec3(0.035,0.19,0.30);
          vec3 mid=vec3(0.20,0.47,0.55);
          vec3 low=vec3(0.72,0.76,0.66);
          vec3 col=mix(low,mid,smoothstep(-0.05,0.30,h));
          col=mix(col,top,smoothstep(0.22,0.85,h));
          float sun=pow(max(0.,dot(normalize(vP),normalize(vec3(0.55,0.32,-0.75)))),280.);
          col+=vec3(1.0,0.78,0.45)*sun*1.5;
          gl_FragColor=vec4(col,1.);
        }`
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xd9f0ec, 0x183b44, 2.1));
    const sun = new THREE.DirectionalLight(0xffe0ab, 2.1);
    sun.position.set(80, 110, -120);
    this.scene.add(sun);
  }

  private buildWater() {
    const seg = this.texQuality === 'high' ? 150 : this.texQuality === 'medium' ? 100 : 64;
    const geo = new THREE.PlaneGeometry(900, 900, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime; varying vec3 vN; varying vec3 vW; varying float vH;
        float wave(vec2 p){
          return sin(p.x*0.055+uTime*0.9)*0.55 + sin(p.y*0.078-uTime*1.1)*0.42 + sin((p.x+p.y)*0.032+uTime*0.6)*0.35;
        }
        void main(){
          vec3 p=position; float h=wave(p.xz); p.y+=h; vH=h;
          float e=1.2;
          float dx=wave(p.xz+vec2(e,0.))-wave(p.xz-vec2(e,0.));
          float dz=wave(p.xz+vec2(0.,e))-wave(p.xz-vec2(0.,e));
          vN=normalize(vec3(-dx,2.*e,-dz));
          vec4 wp=modelMatrix*vec4(p,1.); vW=wp.xyz;
          gl_Position=projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: `
        uniform float uTime; varying vec3 vN; varying vec3 vW; varying float vH;
        void main(){
          vec3 N=normalize(vN);
          vec3 V=normalize(cameraPosition-vW);
          float fres=pow(1.-max(0.,dot(N,V)),3.);
          vec3 deep=vec3(0.025,0.20,0.26);
          vec3 shallow=vec3(0.06,0.35,0.39);
          vec3 sky=mix(vec3(0.35,0.58,0.62),vec3(0.05,0.24,0.36),clamp(reflect(-V,N).y,0.,1.));
          vec3 col=mix(deep,shallow,clamp(vH*0.5+0.5,0.,1.));
          col=mix(col,sky,fres*0.75);
          vec3 L=normalize(vec3(0.55,0.32,-0.75));
          float spec=pow(max(0.,dot(reflect(-L,N),V)),90.);
          col+=vec3(1.,0.82,0.55)*spec*0.9;
          float foam=smoothstep(0.95,1.25,vH)*0.25;
          col=mix(col,vec3(0.82,0.93,0.90),foam);
          gl_FragColor=vec4(col,1.);
        }`
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.scene.add(this.water);
  }

  private buildIslands() {
    const sand = new THREE.MeshStandardMaterial({ color: 0xd7c391, roughness: 1 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x63746d, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x3f7a62, roughness: 1 });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x6d4b2d, roughness: 1 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2f704f, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2 + 0.2;
      const r = 205 + (i % 3) * 34;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      const s = 1 + ((i * 7) % 5) * 0.22;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(19 * s, 26 * s, 3, 12), sand);
      base.position.y = 0.8; g.add(base);
      const hill = new THREE.Mesh(new THREE.ConeGeometry(15 * s, 12 * s, 9), i % 4 === 0 ? rock : grass);
      hill.position.y = 7 * s; g.add(hill);
      for (let p = 0; p < 3; p++) {
        const pa = p * 2.1 + i;
        const palm = new THREE.Group();
        palm.position.set(Math.cos(pa) * 13 * s, 2, Math.sin(pa) * 13 * s);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 8 * s, 6), trunk);
        st.position.y = 4 * s; st.rotation.z = 0.1; palm.add(st);
        for (let l = 0; l < 5; l++) {
          const la = l / 5 * Math.PI * 2;
          const lf = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6 * s, 4), leaf);
          lf.position.set(Math.cos(la) * 2.6 * s, 8 * s, Math.sin(la) * 2.6 * s);
          lf.rotation.set(Math.PI / 2.6, 0, -la);
          palm.add(lf);
        }
        g.add(palm);
      }
      this.scene.add(g);
    }
    // 远处灯塔
    const light = new THREE.Group();
    light.position.set(-180, 0, 120);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 26, 12), new THREE.MeshStandardMaterial({ color: 0xe4e0d0 }));
    tower.position.y = 13; light.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(6, 7, 12), new THREE.MeshStandardMaterial({ color: 0xb1583e }));
    cap.position.y = 29; light.add(cap);
    this.scene.add(light);
  }

  private buildClouds() {
    this.scene.add(this.cloudGroup);
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, opacity: 0.55, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 380;
      sp.position.set(Math.cos(a) * r, 55 + Math.random() * 70, Math.sin(a) * r);
      const s = 35 + Math.random() * 65;
      sp.scale.set(s * 1.8, s, 1);
      sp.userData.speed = 0.6 + Math.random() * 1.2;
      this.cloudGroup.add(sp);
    }
  }

  private buildChests() {
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: .8 }));
      g.add(box);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.4, 10, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x9c6631 }));
      lid.rotation.z = Math.PI / 2; lid.position.y = 1.1; g.add(lid);
      const band = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 2.6), new THREE.MeshStandardMaterial({ color: 0xe8b95a, metalness: .7, roughness: .3 }));
      band.position.y = .3; g.add(band);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.gold, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(9, 9, 1); glow.position.y = 1.5; g.add(glow);
      g.visible = false;
      this.scene.add(g);
      this.chests.push(g);
    }
  }

  private hullGeometry() {
    const sections = [
      { z: -8.5, w: 1.9 }, { z: -6, w: 3.1 }, { z: -2, w: 3.8 },
      { z: 2, w: 3.9 }, { z: 6, w: 3.1 }, { z: 9.5, w: 0.25 }
    ];
    const ring = (w: number) => [
      new THREE.Vector3(-w, 1.3, 0), new THREE.Vector3(-w * .96, 0, 0),
      new THREE.Vector3(0, -1.6, 0), new THREE.Vector3(w * .96, 0, 0),
      new THREE.Vector3(w, 1.3, 0)
    ];
    const pos: number[] = [];
    const rings = sections.map(s => ring(s.w).map(v => new THREE.Vector3(v.x, v.y, s.z)));
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < 4; j++) {
        const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      }
    }
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as [number, boolean][]) {
      const r = rings[ri];
      for (let j = 1; j < 4; j++) {
        if (flip) pos.push(r[0].x, r[0].y, r[0].z, r[j + 1].x, r[j + 1].y, r[j + 1].z, r[j].x, r[j].y, r[j].z);
        else pos.push(r[0].x, r[0].y, r[0].z, r[j].x, r[j].y, r[j].z, r[j + 1].x, r[j + 1].y, r[j + 1].z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  makeShip(color: number, name: string) {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ map: this.woodTex, color: 0xffffff, roughness: .85, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(this.hullGeometry(), hullMat);
    hull.name = 'hull'; g.add(hull);
    const deckShape = new THREE.Shape();
    deckShape.moveTo(0, -8.5); deckShape.lineTo(1.9, -8.5); deckShape.lineTo(3.1, -6);
    deckShape.lineTo(3.8, -2); deckShape.lineTo(3.9, 2); deckShape.lineTo(3.1, 6);
    deckShape.lineTo(.25, 9.5); deckShape.lineTo(-.25, 9.5); deckShape.lineTo(-3.1, 6);
    deckShape.lineTo(-3.9, 2); deckShape.lineTo(-3.8, -2); deckShape.lineTo(-3.1, -6);
    deckShape.lineTo(-1.9, -8.5); deckShape.closePath();
    const deckGeo = new THREE.ShapeGeometry(deckShape);
    deckGeo.rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0x9c7042, roughness: .9, side: THREE.DoubleSide }));
    deck.position.y = 1.32; g.add(deck);

    // 舷侧炮口
    const portMat = new THREE.MeshStandardMaterial({ color: 0x241a13, roughness: 1 });
    const cannonMat = new THREE.MeshStandardMaterial({ color: 0x2b3134, metalness: .7, roughness: .4 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -4.5 + i * 2.9;
        const port = new THREE.Mesh(new THREE.BoxGeometry(.25, .9, 1), portMat);
        port.position.set(side * 3.5, .35, z); g.add(port);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.18, .24, 1.6, 8), cannonMat);
        barrel.rotation.z = Math.PI / 2; barrel.position.set(side * 3.8, .35, z); g.add(barrel);
      }
    }
    // 船尾楼
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 3), new THREE.MeshStandardMaterial({ color: 0x6d4728, roughness: .9 }));
    cabin.position.set(0, 2.2, -6); g.add(cabin);
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(.25, 2.4, 2.4), hullMat);
    rudder.position.set(0, .1, -9.2); g.add(rudder);

    const mastDefs = [
      { z: 5.4, height: 12, sw: 6.4, sh: 6.4, y: 7.4 },
      { z: 0.2, height: 15.5, sw: 8.2, sh: 8.2, y: 9.3 },
      { z: -5.2, height: 11.5, sw: 5.6, sh: 5.6, y: 6.9 }
    ];
    const sailMat = new THREE.MeshStandardMaterial({ map: this.sailTex, side: THREE.FrontSide, roughness: 1, transparent: true });
    for (const m of mastDefs) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.17, .27, m.height, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a21 }));
      mast.position.set(0, m.height / 2 + 1.3, m.z); g.add(mast);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, m.sw + 1, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a21 }));
      yard.rotation.z = Math.PI / 2; yard.position.set(0, m.y + m.sh / 2 + .4, m.z); g.add(yard);
      const sg = new THREE.PlaneGeometry(m.sw, m.sh, 8, 8);
      const p = sg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, Math.cos(x / m.sw * Math.PI) * .65 + Math.cos(y / m.sh * Math.PI) * .2);
      }
      sg.computeVertexNormals();
      const sail = new THREE.Mesh(sg, sailMat);
      sail.position.set(0, m.y, m.z);
      sail.name = 'sail'; g.add(sail);
      // 背面单独一片并翻转朝向，确保两侧看到的 LSY 徽记都不是镜像
      const sailBack = new THREE.Mesh(sg, sailMat);
      sailBack.position.set(0, m.y, m.z - 0.03);
      sailBack.rotation.y = Math.PI;
      g.add(sailBack);
    }
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .8 }));
    flag.position.set(1.1, 16, .2); flag.name = 'flag'; g.add(flag);

    // 船名光点（用于识别自己）
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.gold, color, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    marker.position.set(0, 19.5, 0); marker.scale.set(4, 4, 1); marker.name = 'marker'; g.add(marker);
    g.userData.name = name;
    g.traverse(o => { o.userData.shipColor = color; });
    const wake = this.createWake();
    this.wakes.set(name, wake);
    return g;
  }

  private createWake(): Particle[] {
    const arr: Particle[] = [];
    const count = this.texQuality === 'low' ? 24 : 48;
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.splash, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; this.scene.add(sp);
      arr.push({ sprite: sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0, scale: 1, kind: 'wake' });
    }
    return arr;
  }

  syncShips(states: { id: string; x: number; z: number; h: number; speed: number; alive: boolean; color: number; name: string }[], t: number, playerId: string) {
    this.playerId = playerId;
    const ids = new Set(states.map(s => s.id));
    for (const [id, mesh] of this.ships) {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.wakes.get(id)?.forEach(p => { p.sprite.visible = false; });
        this.ships.delete(id); this.wakes.delete(id);
      }
    }
    for (const s of states) {
      let mesh = this.ships.get(s.id);
      if (!mesh) { mesh = this.makeShip(s.color, s.id); this.scene.add(mesh); this.ships.set(s.id, mesh); }
      mesh.visible = s.alive;
      if (!s.alive) continue;
      const wh = waveHeight(s.x, s.z, t);
      mesh.position.set(s.x, wh - .15, s.z);
      const dx = waveHeight(s.x + 3, s.z, t) - waveHeight(s.x - 3, s.z, t);
      const dz = waveHeight(s.x, s.z + 3, t) - waveHeight(s.x, s.z - 3, t);
      mesh.rotation.set(dz * .06, s.h, -dx * .06 - Math.sin(t * 1.3 + s.x) * .015);
      const wake = this.wakes.get(s.id);
      if (wake) {
        for (const p of wake) {
          if (p.life > 0) continue;
          if (Math.abs(s.speed) > 3 && Math.random() < .55) {
            const back = s.speed > 0 ? -9 : 8;
            const px = s.x + Math.sin(s.h) * back + (Math.random() - .5) * 5;
            const pz = s.z + Math.cos(s.h) * back + (Math.random() - .5) * 5;
            p.sprite.position.set(px, waveHeight(px, pz, t) + .25, pz);
            p.life = p.max = 1.6; p.scale = 2.5;
            p.sprite.visible = true;
          }
        }
      }
    }
  }

  syncChests(chests: { id: number; x: number; z: number; alive: boolean }[], t: number) {
    for (let i = 0; i < this.chests.length; i++) {
      const c = chests[i]; const g = this.chests[i];
      g.visible = !!c?.alive;
      if (!g.visible) continue;
      g.position.set(c.x, waveHeight(c.x, c.z, t) + 1.2, c.z);
      g.rotation.y = t * .7 + i;
      g.position.y += Math.sin(t * 2 + i) * .2;
    }
  }

  spawnEffect(type: 'fire' | 'hit' | 'sink' | 'pickup' | 'dash' | 'respawn' | 'repair', x: number, z: number, t: number) {
    const configs: Record<string, { tex: string; count: number; color?: number; speed: number; life: number; size: number; additive: boolean }> = {
      fire: { tex: 'flash', count: 12, speed: 7, life: .45, size: 3.5, additive: true },
      hit: { tex: 'smoke', count: 12, speed: 5, life: 1.2, size: 4, additive: false },
      sink: { tex: 'fire', count: 36, speed: 11, life: 2.1, size: 7, additive: true },
      pickup: { tex: 'gold', count: 14, speed: 6, life: .9, size: 3, additive: true },
      dash: { tex: 'splash', count: 16, speed: 8, life: .9, size: 4, additive: false },
      respawn: { tex: 'gold', count: 20, speed: 7, life: 1.1, size: 4, additive: true },
      repair: { tex: 'gold', count: 12, speed: 4, life: 1, size: 3, additive: true }
    };
    const cfg = configs[type];
    const cap = this.texQuality === 'low' ? 0.45 : this.texQuality === 'medium' ? 0.75 : 1;
    for (let i = 0; i < Math.ceil(cfg.count * cap); i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex[cfg.tex as keyof typeof this.tex], transparent: true, opacity: 1,
        depthWrite: false, blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending
      }));
      sp.position.set(x + (Math.random() - .5) * 2, waveHeight(x, z, t) + 1 + Math.random() * 2, z + (Math.random() - .5) * 2);
      sp.scale.setScalar(cfg.size * (.5 + Math.random()));
      this.scene.add(sp);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        sprite: sp, life: cfg.life * (.7 + Math.random() * .6), max: cfg.life,
        vx: Math.cos(a) * cfg.speed * Math.random(), vy: 2 + Math.random() * cfg.speed * .5,
        vz: Math.sin(a) * cfg.speed * Math.random(), scale: cfg.size, kind: type
      });
    }
  }

  private updateParticles(dt: number, t: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite); (p.sprite.material as THREE.SpriteMaterial).dispose();
        this.particles.splice(i, 1); continue;
      }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy -= (p.kind === 'fire' || p.kind === 'sink' || p.kind === 'hit' ? 3 : 6) * dt;
      const k = p.life / p.max;
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5);
      p.sprite.scale.setScalar(p.scale * (1.6 - k * .6));
    }
    for (const wake of this.wakes.values()) {
      for (const p of wake) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.sprite.visible = false; continue; }
        const k = p.life / p.max;
        (p.sprite.material as THREE.SpriteMaterial).opacity = k * .32;
        p.sprite.scale.setScalar(p.scale + (1 - k) * 4);
        p.sprite.position.y = waveHeight(p.sprite.position.x, p.sprite.position.z, t) + .2;
      }
    }
  }

  raycastWater(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const ok = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    return ok ? { x: hit.x, z: hit.z } : null;
  }

  setPlayer(id: string, menu: boolean) { this.playerId = id; this.menuMode = menu; }

  update(dt: number, t: number) {
    this.clockT = t;
    this.waterMat.uniforms.uTime.value = t;
    for (const c of this.cloudGroup.children) {
      c.position.x += (c as any).userData.speed * dt;
      if (c.position.x > 480) c.position.x = -480;
    }
    for (const mesh of this.ships.values()) {
      const flag = mesh.getObjectByName('flag');
      if (flag) flag.rotation.y = Math.sin(t * 3) * .35;
    }
    if (this.menuMode) {
      this.menuAngle += dt * .12;
      const x = Math.cos(this.menuAngle) * 22, z = Math.sin(this.menuAngle) * 22;
      this.menuShip.position.set(x, waveHeight(x, z, t), z);
      this.menuShip.rotation.set(0, this.menuAngle + Math.PI / 2, Math.sin(t) * .03);
      this.camPos.set(x + Math.cos(this.menuAngle + 2.2) * 34, 13, z + Math.sin(this.menuAngle + 2.2) * 34);
      this.camTarget.set(x, 4, z);
      this.menuShip.visible = true;
    } else {
      this.menuShip.visible = false;
      const me = this.ships.get(this.playerId);
      if (me) {
        const h = me.rotation.y;
        const dist = 27, height = 15;
        const want = new THREE.Vector3(me.position.x - Math.sin(h) * dist, height, me.position.z - Math.cos(h) * dist);
        this.camPos.lerp(want, Math.min(1, dt * 4));
        this.camTarget.lerp(new THREE.Vector3(me.position.x + Math.sin(h) * 8, 3, me.position.z + Math.cos(h) * 8), Math.min(1, dt * 5));
      }
    }
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 5));
    this.camera.lookAt(this.camTarget);
    this.updateParticles(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export const botColors = [0xf0a85c, 0xe76b62, 0x8d7bd6, 0x7ac9a8, 0xd8c36a, 0x6fa8d6];
export const arenaRadius = RULES.arenaR;
