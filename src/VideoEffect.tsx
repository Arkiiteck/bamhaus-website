import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type EfectoHandle = {
  reproducir: () => void;
  detener: () => void;
};

type Props = {
  src: string;
  maxSize?: number; // lado máximo (px) del canvas interno; menos = más rápido
};

/**
 * Reproduce un video con fondo negro y lo dibuja en un <canvas> convirtiendo
 * el negro en transparencia (el brillo de cada píxel pasa a ser su opacidad).
 * Funciona sobre cualquier fondo de la página, y es ideal para fuego, chispas,
 * luces, humo o confeti grabados sobre negro.
 */
const VideoEffect = forwardRef<EfectoHandle, Props>(function VideoEffect(
  { src, maxSize = 640 },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const raf = useRef<number | null>(null);

  const limpiar = () => {
    const c = canvasRef.current;
    const ctx = ctxRef.current;
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
  };

  const parar = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const dibujar = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) {
      raf.current = requestAnimationFrame(dibujar);
      return;
    }

    // Tamaño interno del canvas según el video
    const k = Math.min(1, maxSize / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k);
    const h = Math.round(v.videoHeight * k);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      ctxRef.current = null;
    }
    if (!ctxRef.current) ctxRef.current = c.getContext('2d', { willReadFrequently: true });
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.drawImage(v, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Negro -> transparente. alpha = brillo del píxel, y se recupera el color real.
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = Math.max(r, g, b);
      if (a === 0) {
        d[i + 3] = 0;
        continue;
      }
      const f = 255 / a;
      d[i] = r * f;
      d[i + 1] = g * f;
      d[i + 2] = b * f;
      d[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);

    raf.current = requestAnimationFrame(dibujar);
  };

  useImperativeHandle(ref, () => ({
    reproducir: () => {
      const v = videoRef.current;
      if (!v) return;
      parar();
      v.currentTime = 0;
      v.play()
        .then(() => {
          raf.current = requestAnimationFrame(dibujar);
        })
        .catch((err) => console.error('No se pudo reproducir el video del efecto', err));
    },
    detener: () => {
      videoRef.current?.pause();
      parar();
      limpiar();
    },
  }));

  useEffect(() => () => parar(), []);

  return (
    <>
      {/* El video queda oculto: solo sirve de fuente para el canvas */}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        onEnded={() => {
          parar();
          limpiar();
        }}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          pointerEvents: 'none',
        }}
      />
    </>
  );
});

export default VideoEffect;