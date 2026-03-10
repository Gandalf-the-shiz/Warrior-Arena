# ⚔️ WARRIOR ARENA

> *The most brutal endless arena combat game ever made — in your browser.*

## 🎮 What Is This?
Dark fantasy gladiator combat. You are a fully armored knight thrown into a Roman Colosseum, facing endless waves of increasingly savage enemies. No mercy. No escape. Only blood and glory.

**Tech Stack:** Three.js • Rapier Physics • TypeScript • Vite • Web Audio API

## 🔥 THE VISION

### The Warrior
- Fully armored medieval knight — plate armor, greatsword, kite shield, flowing cape
- **Dynamic Armor Degradation**: Armor starts pristine and gleaming (high metalness, low roughness). As the warrior takes damage through waves, armor gets:
  - Dented (procedural normal map deformation)
  - Blood-splattered (accumulating blood texture overlay)
  - Scratched and dulled (roughness increases, metalness decreases)
  - By wave 15+ the warrior should look like a blood-soaked war veteran
- PBR materials throughout with environment map reflections

### The Enemies
- Skeletons, Ghouls, Brutes, Necromancers — each procedurally built
- **Full Dismemberment System**: Every enemy has separable body parts
  - Light attacks: sever arms, hands, heads
  - Heavy attacks: bisect torsos, split heads vertically
  - Finishers: spectacular multi-part dismemberment
- Severed limbs become physics objects that tumble and roll
- Arterial blood spray from severed points

### The Arena — Roman Colosseum
- Authentic Roman architecture: tiered seating, arched vomitoria, emperor's box
- Sand floor that gets progressively blood-soaked
- Torchlight with ember particles, atmospheric dust
- Environmental hazards: spike traps, fire pillars

### The Crowd
- **Dynamic Crowd Audio & Behavior**:
  - Quiet/murmuring at wave start
  - ROAR when warrior makes contact with enemies
  - Chanting during kill streaks
  - Screaming during finishers
  - Booing if the warrior takes too long

### Combat & Gore
- Visceral impact: camera shake, hitstop, chromatic aberration on heavy hits
- Blood particle system: directional sprays, pooling, persistent decals
- Screen-space blood splatter on close kills
- Style meter system (D → S rank) with combat multipliers
- Weapon impacts with sparks on armored enemies

### Progression
- Endless waves with scaling difficulty
- XP & leveling (1-10) with stat bonuses
- Between-wave skill selection (roguelite elements)
- Boss waves every 5th wave
- Wave modifiers: BERSERKER, ARMORED, SWARM, ELITE
- Weather system: Clear, Fog, Blood Moon, Storm

## 🏗️ Architecture
```
src/
├── engine/          # Core systems
│   ├── GameLoop.ts        # Fixed-timestep (60Hz physics, uncapped render)
│   ├── Renderer.ts        # Three.js + post-processing pipeline
│   ├── PhysicsWorld.ts    # Rapier 3D wrapper
│   ├── InputManager.ts    # Keyboard, mouse, touch, virtual joystick
│   └── AudioManager.ts    # Procedural Web Audio synthesis
├── game/            # Game logic
│   ├── Arena.ts           # Colosseum environment
│   ├── ArmorDegradation.ts# Dynamic armor wear & blood accumulation
│   ├── WarriorModel.ts    # Player character model
│   ├── PlayerController.ts# Player physics, combat, state
│   ├── Enemy.ts           # Enemy types & AI
│   ├── BossEnemy.ts       # Boss encounters
│   ├── EnemyCommander.ts  # Commander enemy type
│   ├── CombatSystem.ts    # Hit detection & damage
│   ├── FinisherSystem.ts  # Execution moves
│   ├── VFXManager.ts      # Visual effects (blood, sparks, trails)
│   ├── WaveManager.ts     # Wave spawning & progression
│   ├── StyleMeter.ts      # Combo/style tracking
│   ├── SkillSystem.ts     # Roguelite buffs
│   ├── LevelSystem.ts     # XP & leveling
│   ├── WeatherSystem.ts   # Dynamic weather
│   ├── ArenaHazards.ts    # Spike traps, fire pillars
│   ├── CameraController.ts# Third-person camera
│   └── ScoreManager.ts    # Persistent best scores
├── ui/              # User interface
│   ├── HUD.ts             # Health, stamina, wave, kills, style
│   ├── TitleScreen.ts     # Title screen
│   ├── PauseMenu.ts       # Pause overlay
│   ├── DamageNumbers.ts   # Floating damage text
│   ├── Minimap.ts         # Radar minimap
│   ├── BossHealthBar.ts   # Boss HP display
│   ├── SkillPicker.ts     # Between-wave skill cards
│   ├── WaveAnnouncer.ts   # Wave announcement overlay
│   ├── ScreenEffects.ts   # Screen-space effects
│   ├── EnemyHealthBars.ts # Floating enemy HP bars
│   └── WeatherHUD.ts      # Weather state display
└── main.ts          # Bootstrap & game orchestration
```

## 📋 Development Roadmap (3 PRs)
1. **PR 1** — PBR Graphics Foundation + Armor Degradation + Vision README
2. **PR 2** — Full Dismemberment System + Gore Overhaul
3. **PR 3** — Dynamic Crowd System + Audio Overhaul + Final Polish

## 🎨 Art Direction
- Cartoonish-realistic hybrid (think: "Mordhau meets Hades")
- Procedural models enhanced with PBR materials
- Warm torchlight palette: amber, gold, deep shadows
- Blood: dark crimson (#8B0000) to bright arterial red (#FF0000)
- Metal: polished steel (#A8A8A8) degrading to battle-worn rust (#5C4033)
