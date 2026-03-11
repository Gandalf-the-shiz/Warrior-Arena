# ⚔️ WARRIOR ARENA

> *The most brutal endless arena combat game ever made — in your browser.*

---

## 🤖 COPILOT AGENT INSTRUCTIONS

**Read this section first** if you are an AI agent working on this repository.

### Tech Stack
| Layer | Technology | Version |
|---|---|---|
| Renderer | Three.js | 0.183.2 |
| Physics | @dimforge/rapier3d-compat | 0.19.3 |
| Language | TypeScript | 5.9.3 |
| Build | Vite | 7.3.1 |
| Audio | Web Audio API (procedural) | — |

### Key Architectural Rules
1. **No external assets** — Everything is procedural. No `.glb`, `.gltf`, texture files, or audio files. Models are built from Three.js primitives; audio is synthesised at runtime via Web Audio API.
2. **`@/` alias** points to `src/` (configured in `tsconfig.json` and `vite.config.ts`).
3. **Fixed 60 Hz physics loop** (`GameLoop.ts`) + uncapped render loop. Enemy AI runs in the variable render delta.
4. **TypeScript strict mode** — run `npx tsc --noEmit` to validate; it must pass with zero errors.
5. **Build command**: `npm run build` (Vite). **Type check**: `npx tsc --noEmit`.

### The Vision (One Paragraph)
Warrior Arena is a **dark-fantasy endless arena combat game** — the most brutal endless arena game ever made — running entirely in the browser. You are a fully armored medieval knight thrown into a Roman Colosseum, facing infinite waves of skeletons, ghouls, brutes, and necromancers. The art direction is a **cartoonish-realistic hybrid**: "Mordhau meets Hades". Warm torchlight palette, blood spraying on every hit, limbs flying off on every finisher, armor starting pristine and gradually becoming a blood-soaked, dented wreck by wave 15.

### Art Direction Reference
| Element | Value |
|---|---|
| Base armor color (pristine) | `#a0b0d0` (steel blue) |
| Base armor color (worn) | `#4a3828` (dark iron/rust) |
| Blood color range | dark crimson `#8B0000` → arterial red `#FF0000` |
| Torch ambient | warm amber `#c86428` → dark stone `#0a0808` |
| Sky background | deep dark blue `#1a1a3e` |
| PBR: pristine metalness / roughness | `0.90` / `0.15` |
| PBR: worn metalness / roughness | `0.30` / `0.70` |

### PR Roadmap Status
| PR | Status | Content |
|---|---|---|
| **PR 1** | ✅ Complete | PBR graphics foundation, armor degradation (canvas blood + dent normals), `spawnSparks()` in VFXManager, README vision |
| **PR 2** | ✅ Complete | Full dismemberment system, gore VFX overhaul, arterial spray, severed physics limbs |
| **PR 3** | 🔜 Pending | Dynamic crowd system, audio overhaul, final polish |

### System Interconnections (Critical)
```
PlayerController
  ├─ warrior: WarriorModel          ← procedural PBR armored knight
  ├─ armorDegradation: ArmorDegradation
  │     ├─ onHitTaken(worldPos)     ← called from takeDamage(amount, sourcePos)
  │     ├─ onEnemyKilled()          ← called from main.ts kill callback
  │     ├─ onWaveAdvanced(wave)     ← called from main.ts after startNextWave()
  │     └─ update(delta)            ← reserved for animated transitions
  └─ takeDamage(amount, sourcePos?) ← called by CombatSystem (enemy/boss/commander/projectile)

CombatSystem.update(player, enemies, vfx, …, dismemberment)
  ├─ player.takeDamage(dmg, attacker.getPosition())
  └─ dismemberment.onEnemyKilled(enemy, dir, attackType)   ← on kill

main.ts kill callback:
  ├─ player.armorDegradation.onEnemyKilled()
  ├─ arena.onEnemyKilled()
  └─ vfx.onKill(playerPos)

main.ts wave callback (after startNextWave()):
  └─ player.armorDegradation.onWaveAdvanced(waves.currentWave)

VFXManager
  ├─ spawnHitSparks(pos, dir)       ← called by CombatSystem
  └─ spawnSparks(pos, normal)       ← new PBR wrapper; delegates to spawnHitSparks
```

---

## 🎮 What Is This?

Dark fantasy gladiator combat. You are a fully armored knight thrown into a Roman Colosseum, facing endless waves of increasingly savage enemies. No mercy. No escape. Only blood and glory.

**Tech Stack:** Three.js • Rapier Physics • TypeScript • Vite • Web Audio API

---

## 🔥 THE VISION

### The Warrior
A fully armored medieval knight. The armor starts **pristine and gleaming** (metalness 0.9, roughness 0.15, clearcoat 0.35). As the warrior battles through waves:

| Stage | Wave | Armor State |
|---|---|---|
| **Pristine** | Wave 1 | Mirror-polished steel, every torch reflected |
| **Scratched** | Wave 3–5 | Light scratches, slight dulling |
| **Battle-worn** | Wave 8–10 | Visible dents, blood from early kills |
| **Veteran** | Wave 12–15 | Heavy denting, darkened steel, blood-soaked |
| **Legend** | Wave 15+ | Rust-toned, dented wreck dripping with gore |

**Armor components**: chest plate (cuirass), pauldrons (shoulder guards), gauntlets, greaves (leg armor), sabatons (foot armor), gorget (neck guard), bascinet helm with pointed crown, visor slit with **amber emissive glow** (menacing glow from within).

**Weapons**: greatsword with enchanted blue emissive glow and blood groove. Kite shield with heraldic emblem (shown during block).

**Cape**: crimson flowing cape with vertex-wave animation.

### ArmorDegradation System
`src/game/ArmorDegradation.ts` — manages all visual armor wear:

- **Canvas blood texture** (`emissiveMap`): starts transparent. Each `onEnemyKilled()` call paints randomised blood splatters with drip streaks. Each `onHitTaken()` paints a small blood spot at the impact location.
- **Canvas normal map** (`normalMap`): starts with a rivet grid + panel-seam surface detail pattern. Each `onHitTaken()` / `onHit()` call paints a concave dent at the impact location.
- **Wave wear**: `onWaveAdvanced(wave)` ramps up roughness/metalness/color progressively (full wear at wave 15).
- **Material progression**: `roughness` 0.15 → 0.70, `metalness` 0.90 → 0.30, `clearcoat` 0.35 → 0.00, color steel blue → dark iron.

### The Enemies
- **Skeleton** — fast, low HP, glass cannon
- **Ghoul** — medium speed, leaping attacks
- **Brute** — slow tank, high damage, knockback
- **Necromancer** — ranged projectiles, stays at distance
- **Commander** (wave 8+) — elite enemy, larger, more aggressive
- **Boss** (every 5th wave) — massive HP, slam shockwave attacks

**Full Dismemberment**: Every enemy has separable body parts (head, left/right arm, left/right leg, torso). Light attacks sever arms and heads. Heavy attacks bisect torsos and split heads vertically. Finisher (`F` key) triggers spectacular multi-part dismemberment sequences. Severed limbs become Rapier physics objects that tumble and bleed.

### The Arena — Roman Colosseum
Entirely procedural (`Arena.ts`, 42KB). Features:
- Tiered stone seating in concentric rings
- Arched vomitoria (entrance tunnels) at compass points
- Emperor's box elevated platform
- Sand floor with persistent blood decals
- Ring of torches with ember particles and warm amber light
- Spike trap and fire pillar hazards (ArenaHazards.ts)

### The Crowd
Dynamic audio currently handled by `AudioManager.ts` (procedural Web Audio synthesis):
- Quiet murmuring at wave start
- Crowd roar on warrior-enemy contact
- Chanting during kill streaks (5+ kills, 10+ kills)
- Screaming during finisher executions
- Audio fully procedural — no audio files required

### Combat & Gore
- **VFX system** (`VFXManager.ts`, 30KB): blood bursts (60 particles), arterial spray, gore chunks, screen-space blood, sword trails, dodge afterimages, kill-streak aura
- **Spark effects**: `spawnHitSparks()` / `spawnSparks()` — orange/white metallic sparks on armor impacts
- **Screen effects**: camera shake, chromatic aberration (StyleMeter-driven), film grain, vignette, bloom
- **Style meter**: D → S rank, combat multipliers, combo display
- **Hitstop**: 0.05s light, 0.10s heavy, 0.15s finisher

### Progression
- Endless waves with scaling difficulty
- XP & leveling (1–10) with stat bonuses
- Between-wave skill selection (roguelite card picks)
- Boss every 5th wave
- Wave modifiers: BERSERKER, ARMORED, SWARM, ELITE
- Weather system: Clear, Fog, Blood Moon, Storm
- Loot drops: HP orbs, stamina crystals

---

## 🏗️ Architecture

```
src/
├── engine/               # Core engine systems
│   ├── GameLoop.ts            # Fixed-timestep 60Hz physics + uncapped render
│   ├── Renderer.ts            # Three.js WebGL + post-processing pipeline
│   │                          # (bloom, vignette, CA, film grain, color grade)
│   │                          # buildEnvironmentMap() → procedural IBL cubemap
│   ├── PhysicsWorld.ts        # Rapier 3D WASM wrapper
│   ├── InputManager.ts        # Keyboard, mouse, touch, virtual joystick
│   └── AudioManager.ts        # Procedural Web Audio synthesis (no audio files)
│
├── game/                 # Game systems
│   ├── WarriorModel.ts        # Procedural armored knight (PBR MeshPhysicalMaterial)
│   ├── ArmorDegradation.ts    # Canvas blood texture + normal map dent system
│   ├── PlayerController.ts    # Player physics, combat state machine, skill hooks
│   ├── AnimationStateMachine.ts  # Bone-group animation states
│   ├── CameraController.ts    # Third-person camera + shake
│   ├── Arena.ts               # Roman Colosseum (42KB procedural architecture)
│   ├── ArenaHazards.ts        # Spike traps, fire pillars
│   ├── Enemy.ts               # Skeleton/Ghoul/Brute/Necromancer AI (42KB)
│   ├── BossEnemy.ts           # Boss encounters (wave 5/10/15/...)
│   ├── EnemyCommander.ts      # Elite commander enemy (wave 8+)
│   ├── EnemySpawnVFX.ts       # Portal spawn visual effects
│   ├── CombatSystem.ts        # Hit detection, damage application, VFX dispatch
│   ├── DismembermentSystem.ts # Limb separation logic
│   ├── SeveredPartManager.ts  # Physics-driven severed limb lifecycle
│   ├── FinisherSystem.ts      # Execution moves (F key)
│   ├── VFXManager.ts          # Blood, sparks, trails, afterimages, aura (30KB)
│   ├── WaveManager.ts         # Wave spawning, modifiers, boss scheduling
│   ├── WeatherSystem.ts       # Clear / Fog / Blood Moon / Storm transitions
│   ├── StyleMeter.ts          # D→S rank combo tracking
│   ├── SkillSystem.ts         # Roguelite skill buffs
│   ├── LevelSystem.ts         # XP & leveling
│   ├── LootSystem.ts          # HP/stamina drop spawning
│   └── ScoreManager.ts        # localStorage best-score persistence
│
├── ui/                   # UI overlays
│   ├── HUD.ts                 # Health bar, stamina bar, wave, kill count
│   ├── TitleScreen.ts         # Title + best scores
│   ├── PauseMenu.ts           # Pause overlay
│   ├── DamageNumbers.ts       # Floating hit numbers
│   ├── Minimap.ts             # Radar minimap
│   ├── BossHealthBar.ts       # Boss HP display
│   ├── SkillPicker.ts         # Between-wave skill card selection
│   ├── WaveAnnouncer.ts       # "WAVE 5" announcement overlay
│   ├── ScreenEffects.ts       # Low-health vignette, rage tint
│   ├── EnemyHealthBars.ts     # Floating per-enemy HP bars
│   └── WeatherHUD.ts          # Weather state indicator
│
└── main.ts               # Bootstrap & full system wiring (564 lines)
```

### Asset Pipeline
All assets are generated at runtime — zero file loading:
- **3D models**: Three.js `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `PlaneGeometry` assembled into `THREE.Group` hierarchies
- **PBR materials**: `THREE.MeshPhysicalMaterial` with `metalness`, `roughness`, `clearcoat`, `emissive`
- **Environment map**: procedural equirectangular gradient DataTexture → PMREMGenerator → IBL cubemap (warm amber torchlight)
- **Normal maps**: `HTMLCanvasElement` → `THREE.CanvasTexture`, painted with rivet grid + panel seam lines, then progressively dented
- **Blood textures**: `HTMLCanvasElement` → `THREE.CanvasTexture`, painted per-kill with radial blood splatter + drip streaks
- **Audio**: Web Audio API oscillators, noise buffers, convolution reverb — entirely synthesised

---

## 📋 Development Roadmap

| PR | Status | Scope |
|---|---|---|
| **PR 1** — PBR Graphics Foundation | ✅ Complete | Upgraded `ArmorDegradation` with canvas blood + normal-map dents; `spawnSparks()` in VFXManager; better shadow maps; full wiring in PlayerController / CombatSystem / main.ts; README |
| **PR 2** — Dismemberment Overhaul | ✅ Complete | `DismembermentSystem`, `SeveredPartManager`, arterial spray VFX, gore chunks, finisher sequences |
| **PR 3** — Dynamic Crowd + Audio | 🔜 Pending | Crowd reaction system, spatial audio positioning, enhanced procedural crowd synthesis |

---

## 🎨 Art Direction

**Style**: Cartoonish-realistic hybrid — "Mordhau meets Hades". High contrast, warm torchlight, expressive silhouettes.

**Palette**:
- Sky / background: deep dark blue `#1a1a3e`
- Atmospheric fog: warm amber `#c8a080`
- Torch top glow: `#c86428`
- Stone base: `#0a0808`
- Pristine armor: steel blue `#a0b0d0`
- Battle-worn armor: dark iron `#4a3828`
- Fresh blood: arterial red `#ff0000`
- Dried blood: dark crimson `#8b0000`
- Enchanted sword glow: blue `#4466ff`
- Visor glow: menacing amber/red `#cc2200`

