import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Thin wrapper around the Rapier physics world.
 * Provides helpers to create rigid bodies / colliders and advances the sim.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor() {
    // Slightly heavier gravity for a weighty, impactful feel
    this.world = new RAPIER.World({ x: 0, y: -9.81 * 2, z: 0 });
  }

  /** Advance physics by one fixed step (called by the game loop). */
  step(): void {
    this.world.step();
  }

  /**
   * Create a dynamic rigid body at the given world position.
   * Returned body has its rotations locked so the player stays upright.
   */
  createDynamicBody(
    x: number,
    y: number,
    z: number,
    lockRotations = false,
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    if (lockRotations) {
      desc.lockRotations();
    }
    return this.world.createRigidBody(desc);
  }

  /** Create a static rigid body (immovable) at the given world position. */
  createStaticBody(x: number, y: number, z: number): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    return this.world.createRigidBody(desc);
  }

  /** Attach a capsule collider to a rigid body (for the player character). */
  createCapsuleCollider(
    body: RAPIER.RigidBody,
    radius: number,
    halfHeight: number,
    friction = 0.5,
    restitution = 0.0,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setFriction(friction)
      .setRestitution(restitution);
    return this.world.createCollider(desc, body);
  }

  /** Attach a cuboid collider to a rigid body. */
  createCuboidCollider(
    body: RAPIER.RigidBody,
    hx: number,
    hy: number,
    hz: number,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    return this.world.createCollider(desc, body);
  }

  /** Attach a cylinder collider to a rigid body. */
  createCylinderCollider(
    body: RAPIER.RigidBody,
    halfHeight: number,
    radius: number,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    return this.world.createCollider(desc, body);
  }

  /**
   * Cast a ray from `origin` in `direction` (unit vector) and return the
   * time-of-impact along the ray, or `null` if nothing was hit within
   * `maxToi` (max distance).
   */
  castRay(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    maxToi: number,
  ): number | null {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRay(ray, maxToi, true);
    return hit ? hit.timeOfImpact : null;
  }
}
