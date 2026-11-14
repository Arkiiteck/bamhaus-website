import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, useAnimations, OrbitControls, Environment } from '@react-three/drei';
import {
  Box3, Group, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, PerspectiveCamera,
  Quaternion, SRGBColorSpace, Texture, TextureLoader, Vector3,
} from 'three';

// ---- Assets de la parte frontal de la carta ----
const CARTAS = [
  '/Cards/Card-1.png',
  '/Cards/Card-2.png',
  '/Cards/Card-3.png',
  '/Cards/Card-4.png',
  '/Cards/Card-5.png',
  '/Cards/Card-6.png',
  '/Cards/Card-7.png',
  '/Cards/Card-8.png',
  '/Cards/Card-9.png',
  '/Cards/Card-10.png',
  '/Cards/Card-11.png',
  '/Cards/Card-12.png',
  '/Cards/Card-13.png',
  '/Cards/Card-14.png',
  '/Cards/Card-15.png',
  '/Cards/Card-16.png',
  '/Cards/Card-17.png',
  '/Cards/front.png',
];

// ---- Sonidos (archivos en public/) ----
const SONIDO_SHAKE = '/freesound_community-rattling-box-101252.mp3';
const SONIDO_VICTORIA = '/emand_edroff-victory-bell-success-fanfare-576275.mp3'; // ajusta la extensión si no es .mp3
const DELAY_VICTORIA_MS = 1000; // el sonido de victoria arranca 1 s después de empezar Open

// ---- Ajustes ----
const VUELTAS = 3;
const T_SUBIDA = 1.6;
const T_DETALLE = 1.2;
const CARD_FACE_Y = -Math.PI / 2; // si ves el reverso, cámbialo a Math.PI / 2
const CAJA_EN_CANVAS = 0.6;       // la caja ocupa el 80% del canvas
const CARTA_EN_CAJA = 0.7;        // ancho de la carta respecto al ancho de la caja
const SUBIDA = 0.6;               // cuánto sube la carta sobre la caja (en alturas de carta)
const ELEVACION = 25;             // grados de elevación de la cámara
const TURN_NAME = 'Turn';         // nombre del clip (también acepta "Turn right", "TurnRight"...)
const SENSIBILIDAD = 0.01;        // rotación de la carta por píxel arrastrado

type Fase = 'reposo' | 'abriendo' | 'subiendo' | 'detalle' | 'fin';

export type ExperienceHandle = {
  abrir: () => void;
  agitar: () => void;
  alternarGiro: () => void;
  cerrar: () => void; // "Abrir siguiente caja": quita la carta y deja la caja lista
};

type Props = {
  onBloqueado: (bloqueado: boolean) => void;  // animación en curso (Shake / Open / carta)
  onGirando: (girando: boolean) => void;      // Turn está reproduciéndose
  onCartaLista: (lista: boolean) => void;     // la carta ya está en plano detalle
  onEfecto: (activo: boolean) => void;        // iniciar / detener el video de efectos
};

type Medidas = {
  escala: number;
  alto: number;
  centro: Vector3;
  radio: number;
  esquinas: Vector3[];
  inicio: Vector3;
  cima: Vector3;
};

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - Math.pow(-2 * k + 2, 3) / 2);

const _q = new Quaternion();
const _v = new Vector3();

function indiceAleatorio(max: number) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return Math.floor((buf[0] / 2 ** 32) * max);
}

const Experience = forwardRef<ExperienceHandle, Props>(function Experience(
  { onBloqueado, onGirando, onCartaLista, onEfecto },
  ref,
) {
  const box = useGLTF('/Box.glb');
  const card = useGLTF('/Card.glb');
  const { actions, mixer, names } = useAnimations(box.animations, box.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);

  const cartaRef = useRef<Group>(null);
  const fase = useRef<Fase>('reposo');
  const t = useRef(0);
  const desde = useRef({ pos: new Vector3(), quat: new Quaternion() });
  const hasta = useRef({ pos: new Vector3(), quat: new Quaternion() });
  const texturas = useRef(new Map<string, Texture>());
  const girando = useRef(false);
  const turnRecortado = useRef(false);
  const shakeAudio = useRef<HTMLAudioElement | null>(null);
  const arrastre = useRef({ activo: false, x: 0, y: 0, vx: 0, vy: 0 });
  const [controles, setControles] = useState(true);
  const [medidas, setMedidas] = useState<Medidas | null>(null);

  // ---- Audio del shake (se precarga una vez) ----
  useEffect(() => {
    const a = new Audio(SONIDO_SHAKE);
    a.loop = true; // si el sonido es más corto que la animación, se repite
    a.preload = 'auto';
    shakeAudio.current = a;
    return () => {
      a.pause();
    };
  }, []);

  // ---- Medidas reales de la carta (proporción original) ----
  const medidasCarta = useMemo(() => {
    const b = new Box3().setFromObject(card.scene);
    const s = b.getSize(new Vector3());
    const c = b.getCenter(new Vector3());
    return {
      ancho: Math.max(s.x, s.z), // el eje más pequeño es el grosor
      alto: s.y,
      centro: c,
    };
  }, [card.scene]);

  // ---- Pose por defecto: primer frame de Open, en pausa ----
  const poseCerrada = () => {
    Object.values(actions).forEach((a) => a?.stop());
    const open = actions['Open'];
    if (!open) return;
    open.reset().play();
    open.paused = true;
    open.time = 0;
  };

  // ---- Animación Turn (solo con el botón) ----
  const getTurn = () => {
    const nombre = actions[TURN_NAME] ? TURN_NAME : names.find((n) => n.startsWith(TURN_NAME));
    return nombre ? actions[nombre] : null;
  };

  const iniciarTurn = () => {
    const turn = getTurn();
    if (!turn || fase.current !== 'reposo' || girando.current) return;
    Object.values(actions).forEach((a) => a?.stop());

    // Recorta un frame del final, una sola vez, para que el bucle no repita la pose
    const clip = turn.getClip();
    const frameDur = 1 / 30; // cámbialo a 1 / 24 si exportaste a 24 fps
    if (!turnRecortado.current && clip.duration > frameDur * 2) {
      clip.duration -= frameDur;
      turnRecortado.current = true;
    }

    turn.setLoop(LoopRepeat, Infinity);
    turn.clampWhenFinished = false;
    turn.reset().play();
    girando.current = true;
    onGirando(true);
  };

  const detenerTurn = () => {
    if (!girando.current) return;
    getTurn()?.stop();
    girando.current = false;
    onGirando(false);
    poseCerrada(); // vuelve al primer frame de Open
  };

  const alternarGiro = () => {
    if (girando.current) detenerTurn();
    else iniciarTurn();
  };

  // Deja la caja cerrada y MIDE la caja en esa pose (no desplegada)
  useEffect(() => {
    poseCerrada();
    mixer.update(0);
    box.scene.updateMatrixWorld(true);

    const b = new Box3().setFromObject(box.scene, true);
    const s = b.getSize(new Vector3());
    const centro = b.getCenter(new Vector3());

    const escala = (Math.min(s.x, s.z) * CARTA_EN_CAJA) / medidasCarta.ancho;
    const alto = medidasCarta.alto * escala;

    const esquinas: Vector3[] = [];
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) esquinas.push(new Vector3(x, y, z));

    setMedidas({
      escala,
      alto,
      centro,
      radio: s.length() / 2,
      esquinas,
      inicio: new Vector3(centro.x, b.min.y + s.y * 0.4, centro.z),
      cima: new Vector3(centro.x, b.max.y + alto * SUBIDA, centro.z),
    });
  }, [actions, mixer, box.scene, medidasCarta]);

  // ---- Encuadre: frontal, 25° de elevación, caja al 80% del canvas ----
  useEffect(() => {
    if (!medidas) return;
    const rad = (ELEVACION * Math.PI) / 180;
    const dir = new Vector3(0, Math.sin(rad), Math.cos(rad));
    const v = new Vector3();
    let dist = medidas.radio * 4;

    for (let i = 0; i < 12; i++) {
      camera.position.copy(dir).multiplyScalar(dist).add(medidas.centro);
      camera.near = dist / 100;
      camera.far = dist * 20;
      camera.lookAt(medidas.centro);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      let m = 0;
      for (const c of medidas.esquinas) {
        v.copy(c).project(camera);
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
      dist *= m / CAJA_EN_CANVAS;
    }

    camera.position.copy(dir).multiplyScalar(dist).add(medidas.centro);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.lookAt(medidas.centro);
    camera.updateProjectionMatrix();
  }, [camera, medidas, size.width, size.height]);

  // ---- Textura de la carta ----
  const cargarTextura = async (url: string) => {
    const cache = texturas.current.get(url);
    if (cache) return cache;
    const tex = await new TextureLoader().loadAsync(url);
    tex.flipY = false;
    tex.colorSpace = SRGBColorSpace;
    texturas.current.set(url, tex);
    return tex;
  };

  const ponerImagenFrente = (tex: Texture) => {
    card.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (m.name === 'Front') {
          (m as MeshStandardMaterial).map = tex;
          m.needsUpdate = true;
        }
      });
    });
  };

  // ---- Girar la carta con el mouse / dedo cuando está en plano detalle ----
  const girarCarta = (dx: number, dy: number) => {
    const g = cartaRef.current;
    if (!g) return;
    // Ejes de la cámara: la carta gira "como la ves", sin importar su orientación
    _v.set(0, 1, 0).applyQuaternion(camera.quaternion);
    g.quaternion.premultiply(_q.setFromAxisAngle(_v, dx * SENSIBILIDAD));
    _v.set(1, 0, 0).applyQuaternion(camera.quaternion);
    g.quaternion.premultiply(_q.setFromAxisAngle(_v, dy * SENSIBILIDAD));
  };

  useEffect(() => {
    const el = gl.domElement;

    const down = (e: PointerEvent) => {
      if (fase.current !== 'fin') return;
      arrastre.current = { activo: true, x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const a = arrastre.current;
      if (!a.activo) return;
      a.vx = e.clientX - a.x;
      a.vy = e.clientY - a.y;
      a.x = e.clientX;
      a.y = e.clientY;
      girarCarta(a.vx, a.vy);
    };
    const up = (e: PointerEvent) => {
      arrastre.current.activo = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ya liberado */
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, camera]);

  // ---- Acciones públicas ----
  // Shake y Open interrumpen el giro si estaba activo; nunca hay dos animaciones a la vez
  const agitar = () => {
    const a = actions['Shake'];
    if (!a || fase.current !== 'reposo') return;
    detenerTurn();
    fase.current = 'abriendo';
    onBloqueado(true);
    actions['Open']?.stop();
    a.setLoop(LoopOnce, 1);
    a.clampWhenFinished = false;
    a.reset().play();

    // Sonido mientras dure la animación
    const s = shakeAudio.current;
    if (s) {
      s.currentTime = 0;
      s.play().catch((err) => console.error('No se pudo reproducir el sonido del shake', err));
    }
  };

  const abrir = async () => {
    if (fase.current !== 'reposo') return;
    const open = actions['Open'];
    if (!open) return;

    detenerTurn();
    fase.current = 'abriendo';
    onBloqueado(true);
    setControles(false);

    try {
      const indice = indiceAleatorio(CARTAS.length);
      ponerImagenFrente(await cargarTextura(CARTAS[indice]));
    } catch (err) {
      console.error('No se pudo cargar la imagen de la carta', err);
      fase.current = 'reposo';
      onBloqueado(false);
      setControles(true);
      poseCerrada();
      return;
    }

    open.setLoop(LoopOnce, 1);
    open.clampWhenFinished = true;
    open.reset().play();

    // Sonido de victoria 1 s después de empezar. Es un Audio nuevo y nunca se
    // detiene, así que suena completo aunque la animación termine antes.
    window.setTimeout(() => {
      new Audio(SONIDO_VICTORIA)
        .play()
        .catch((err) => console.error('No se pudo reproducir el sonido de victoria', err));
    }, DELAY_VICTORIA_MS);
  };

  // "Abrir siguiente caja": única forma de quitar la carta y reiniciar
  const cerrar = () => {
    if (fase.current !== 'fin') return;
    arrastre.current = { activo: false, x: 0, y: 0, vx: 0, vy: 0 };
    if (cartaRef.current) cartaRef.current.visible = false;
    onEfecto(false);
    onCartaLista(false);
    poseCerrada();
    fase.current = 'reposo';
    setControles(true);
    onBloqueado(false);
  };

  useImperativeHandle(ref, () => ({ abrir, agitar, alternarGiro, cerrar }));

  // ---- Fin de animaciones de la caja ----
  useEffect(() => {
    if (!medidas) return;
    const onFinished = (e: any) => {
      if (e.action === actions['Shake']) {
        const s = shakeAudio.current;
        if (s) {
          s.pause();
          s.currentTime = 0;
        }
        poseCerrada();
        fase.current = 'reposo';
        onBloqueado(false);
      } else if (e.action === actions['Open']) {
        const g = cartaRef.current;
        if (!g) return;
        g.position.copy(medidas.inicio);
        g.rotation.set(0, 0, 0);
        g.visible = true;
        t.current = 0;
        fase.current = 'subiendo';
        onEfecto(true); // arranca el video de efectos al salir la carta
      }
    };
    mixer.addEventListener('finished', onFinished);
    return () => mixer.removeEventListener('finished', onFinished);
  }, [mixer, actions, medidas]);

  // ---- Animación de la carta ----
  useFrame((_, delta) => {
    const g = cartaRef.current;
    if (!g || !medidas) return;

    if (fase.current === 'subiendo') {
      t.current += delta;
      const k = Math.min(t.current / T_SUBIDA, 1);
      const e = easeOut(k);
      g.position.lerpVectors(medidas.inicio, medidas.cima, e);
      g.rotation.set(0, e * Math.PI * 2 * VUELTAS, 0); // giro HORIZONTAL (eje Y)

      if (k >= 1) {
        const dist = medidas.alto / (1.1 * Math.tan((camera.fov * Math.PI) / 360));
        const dir = new Vector3();
        camera.getWorldDirection(dir);
        desde.current.pos.copy(g.position);
        desde.current.quat.copy(g.quaternion);
        hasta.current.pos.copy(camera.position).addScaledVector(dir, dist);
        hasta.current.quat.copy(camera.quaternion);
        t.current = 0;
        fase.current = 'detalle';
      }
    } else if (fase.current === 'detalle') {
      t.current += delta;
      const k = Math.min(t.current / T_DETALLE, 1);
      const e = easeInOut(k);
      g.position.lerpVectors(desde.current.pos, hasta.current.pos, e);
      g.quaternion.slerpQuaternions(desde.current.quat, hasta.current.quat, e);
      if (k >= 1) {
        fase.current = 'fin';
        onCartaLista(true);
      }
    } else if (fase.current === 'fin') {
      // Inercia: la carta sigue girando un poco al soltarla
      const a = arrastre.current;
      if (a.activo) {
        a.vx *= 0.5;
        a.vy *= 0.5;
      } else if (Math.abs(a.vx) > 0.05 || Math.abs(a.vy) > 0.05) {
        girarCarta(a.vx, a.vy);
        a.vx *= 0.92;
        a.vy *= 0.92;
      }
    }
  });

  // ---- Clic sobre la caja: Shake (si no hay nada en curso) ----
  const onBoxClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 5) return; // fue un arrastre para orbitar
    agitar();
  };

  const c = medidasCarta.centro;

  return (
    <>
      <Environment preset="city" />
      <OrbitControls target={medidas?.centro} enableZoom={false} enabled={controles} />

      <primitive object={box.scene} onClick={onBoxClick} />

      {/* Grupo exterior: posición, giros y escala uniforme (mantiene la proporción) */}
      <group
        ref={cartaRef}
        visible={false}
        scale={medidas?.escala ?? 1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grupo medio: orienta el frente hacia +Z */}
        <group rotation={[0, CARD_FACE_Y, 0]}>
          {/* Se recentra la carta para que gire sobre su propio centro */}
          <primitive object={card.scene} position={[-c.x, -c.y, -c.z]} />
        </group>
      </group>
    </>
  );
});

export default Experience;

useGLTF.preload('/Box.glb');
useGLTF.preload('/Card.glb');