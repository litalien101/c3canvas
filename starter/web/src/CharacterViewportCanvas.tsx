import { Component, type ComponentProps, type RefObject } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, OrthographicCamera, PerspectiveCamera, useProgress } from '@react-three/drei';
import { MOUSE } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { CC3ModelPreview } from './CC3ModelPreview';

type PreviewProps = Omit<ComponentProps<typeof CC3ModelPreview>, 'previewUrl'> & {
  previewUrl: string | null;
};

type CharacterViewportCanvasProps = PreviewProps & {
  cameraKey: number;
  cameraMode: 'orbit' | 'pan' | 'zoom';
  cameraProjection: 'perspective' | 'orthographic';
  fillLightsEnabled: boolean;
  lightingPreset: 'cool' | 'warm';
  onCanvasCreated: () => void;
  onSkinPaintPointerOnModel: (onModel: boolean) => void;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  skinPaintEnabled: boolean;
  skinPaintPointerOnModel: boolean;
};

function PreviewLoadingIndicator({ title = 'Loading character' }: { title?: string }) {
  const { active, progress, item } = useProgress();
  if (!active) return null;
  const currentAsset = item.split('/').pop() || 'Preparing preview';
  const percentage = Math.round(progress);
  return (
    <div className="preview-loading" role="status" aria-live="polite">
      <span className="preview-loading-spinner" aria-hidden="true" />
      <div className="preview-loading-copy">
        <strong>{title}</strong>
        <span>{currentAsset}</span>
        <div className="preview-loading-track" role="progressbar" aria-label="Character preview loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
          <span style={{ width: `${percentage}%` }} />
        </div>
      </div>
      <output>{percentage}%</output>
    </div>
  );
}

class PreviewErrorBoundary extends Component<
  { children: React.ReactNode; resetKey: string; retryUrls: string[] },
  { error: Error | null; resetKey: string }
> {
  state = { error: null as Error | null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; resetKey: string },
  ) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('The 3D character preview failed to load.', error);
  }

  retry = () => {
    for (const url of this.props.retryUrls) useLoader.clear(GLTFLoader, url);
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <div className="preview-status is-error" role="alert">
        <span>Character preview failed: {this.state.error.message}</span>
        <button type="button" onClick={this.retry}>Retry preview</button>
      </div>;
    }
    return this.props.children;
  }
}

function StudioBackdrop() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.055, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#242329" roughness={0.92} />
      </mesh>
      <mesh position={[0, -0.0345, 0]} receiveShadow>
        <cylinderGeometry args={[1.16, 1.2, 0.045, 96]} />
        <meshStandardMaterial color="#29282f" roughness={0.7} metalness={0.12} />
      </mesh>
      <mesh position={[0, -0.0045, 0]} receiveShadow>
        <cylinderGeometry args={[1.08, 1.12, 0.018, 96]} />
        <meshStandardMaterial color="#34323b" roughness={0.72} metalness={0.08} />
      </mesh>
      {[1.12, 0.88, 0.66].map((radius) => (
        <mesh key={radius} rotation-x={-Math.PI / 2} position={[0, 0.006, 0]}>
          <ringGeometry args={[radius, radius + 0.012, 96]} />
          <meshBasicMaterial color="#77747f" transparent opacity={0.22} side={2} />
        </mesh>
      ))}
    </group>
  );
}

function AdaptiveOrthographicCamera() {
  const height = useThree((state) => state.size.height);
  const zoom = Math.max(60, Math.min(210, height / 3.6));
  return <OrthographicCamera makeDefault position={[0.35, 1.1, 5.2]} zoom={zoom} near={0.01} />;
}

export default function CharacterViewportCanvas({
  previewUrl,
  cameraKey,
  cameraMode,
  cameraProjection,
  fillLightsEnabled,
  lightingPreset,
  onCanvasCreated,
  onSkinPaintPointerOnModel,
  orbitControlsRef,
  skinPaintEnabled,
  skinPaintPointerOnModel,
  ...previewProps
}: CharacterViewportCanvasProps) {
  return (
    <>
      <PreviewErrorBoundary
        resetKey={[previewUrl, previewProps.morphPreviewUrl, previewProps.eyePreviewUrl].join('|')}
        retryUrls={[previewUrl, previewProps.morphPreviewUrl, previewProps.eyePreviewUrl].filter((url): url is string => Boolean(url))}
      >
        <Canvas
          shadows
          dpr={[1, 2]}
          frameloop="demand"
          gl={{ antialias: true }}
          onCreated={onCanvasCreated}
          onPointerMissed={() => onSkinPaintPointerOnModel(false)}
        >
          {cameraProjection === 'perspective'
            ? <PerspectiveCamera key={`camera-${cameraKey}`} makeDefault position={[0.35, 1.1, 5.2]} fov={30} near={0.01} />
            : <AdaptiveOrthographicCamera key={`camera-${cameraKey}`} />}
          <ambientLight intensity={fillLightsEnabled ? 0.75 : 0.4} />
          <hemisphereLight
            color={lightingPreset === 'cool' ? '#e2deea' : '#ffe4cf'}
            groundColor="#28252d"
            intensity={fillLightsEnabled ? 0.95 : 0.35}
          />
          <directionalLight
            position={[4, 7, 5]}
            color={lightingPreset === 'cool' ? '#ffffff' : '#ffe1c6'}
            intensity={fillLightsEnabled ? 1.65 : 0.65}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-4, 3, -4]} intensity={fillLightsEnabled ? 0.65 : 0.2} />
          <pointLight
            position={[-3, 2, 4]}
            intensity={fillLightsEnabled ? 0.8 : 0.2}
            color={lightingPreset === 'cool' ? '#92b9f4' : '#ffc28a'}
          />
          {previewUrl && <CC3ModelPreview previewUrl={previewUrl} skinPaintEnabled={skinPaintEnabled} {...previewProps} />}
          <StudioBackdrop />
          <ContactShadows position={[0, 0.02, 0]} opacity={0.24} scale={5} blur={2.3} far={3} />
          <OrbitControls
            ref={orbitControlsRef}
            key={`controls-${cameraKey}-${cameraProjection}`}
            makeDefault
            enabled={!skinPaintEnabled || !skinPaintPointerOnModel}
            enableDamping
            zoomToCursor
            enableRotate
            enablePan
            enableZoom
            mouseButtons={{
              LEFT: cameraMode === 'orbit' ? MOUSE.ROTATE : cameraMode === 'pan' ? MOUSE.PAN : MOUSE.DOLLY,
              MIDDLE: MOUSE.ROTATE,
            }}
            minDistance={0.12}
            maxDistance={14}
            target={[0, 1.35, 0]}
          />
        </Canvas>
      </PreviewErrorBoundary>
      {previewUrl && <PreviewLoadingIndicator title={previewProps.eyePreviewUrl ? 'Loading eye preview' : previewProps.morphPreviewUrl ? 'Loading character morph controls' : undefined} />}
    </>
  );
}
