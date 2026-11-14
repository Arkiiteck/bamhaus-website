import { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience, { type ExperienceHandle } from './Experience';
import VideoEffect, { type EfectoHandle } from './VideoEffect';

const VIDEO_EFECTO = '/Happy Birthday Confetti - Shawn Zimmerman (1080p, h264).mp4'; // <- pon aquí el nombre real de tu video (está en public/)

export default function App() {
  const experiencia = useRef<ExperienceHandle>(null);
  const efecto = useRef<EfectoHandle>(null);
  const [bloqueado, setBloqueado] = useState(false);     // Shake / Open / carta en curso
  const [girando, setGirando] = useState(false);         // Turn en reproducción
  const [cartaLista, setCartaLista] = useState(false);   // carta en plano detalle

  const manejarEfecto = (activo: boolean) => {
    if (activo) efecto.current?.reproducir();
    else efecto.current?.detener();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: 24,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 500,
          height: 500,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <Canvas camera={{ position: [3, 2, 4], fov: 45 }}>
          <Experience
            ref={experiencia}
            onBloqueado={setBloqueado}
            onGirando={setGirando}
            onCartaLista={setCartaLista}
            onEfecto={manejarEfecto}
          />
        </Canvas>

        {/* Video de efectos con el negro convertido en transparencia */}
        <VideoEffect ref={efecto} src={VIDEO_EFECTO} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button disabled={bloqueado} onClick={() => experiencia.current?.abrir()}>
          Abrir caja
        </button>
        <button disabled={bloqueado} onClick={() => experiencia.current?.agitar()}>
          Agitar Caja
        </button>
        <button disabled={bloqueado} onClick={() => experiencia.current?.alternarGiro()}>
          {girando ? 'Detener Giro' : 'Iniciar Giro'}
        </button>
        <button disabled={!cartaLista} onClick={() => experiencia.current?.cerrar()}>
          Abrir siguiente caja
        </button>
      </div>
    </div>
  );
}