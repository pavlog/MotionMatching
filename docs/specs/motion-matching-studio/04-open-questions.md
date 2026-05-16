# MotionMatching Studio Open Questions

Created: 2026-05-14

This document tracks unanswered design questions. Do not assume these are final decisions.

## Import And Conversion

1. Which library stack is reliable enough for MVP FBX import and GLB export?
   - Candidate: AssimpNet + SharpGLTF.
   - Need to test with real Visual FBX and animation FBX files.

2. What is the minimum accepted source animation skeleton mismatch before requiring an advanced mapping UI?
   - Decision so far: automatic guessing, validators, no manual mapping as primary workflow.
   - Need real-asset testing.

3. What exact schema should built-in bone mapping rules use?

4. What preview GLB skeleton naming/binding contract is needed so backend streamed transforms reliably drive Babylon.js skinned meshes?

## Runtime And Motion Matching

5. How closely should MVP Play Mode match the original Unity runtime controller?
   - It should be a mechanics prototype, but exact parity requirements are not yet defined.

6. How should jump state machine timing work in MVP?
   - Small role set is required for readiness.
   - Need detailed behavior for `jump`, `fall_loop`, and `land` selection/synchronization.

7. Should missing required roles degrade by fallback role substitution or only show warnings?
   - Decision so far: Play Mode starts with warning strip.
   - Fallback policy not defined.

8. What exactly is the built-in locomotion feature preset?
   - Direction/position trajectory frames were discussed, but final feature list needs precise definition.

9. Should current `.mmpose/.mmskeleton/.mmfeatures` be produced byte-compatible with the existing Unity serializer, or only semantically compatible enough for deserialization?

10. What path/point-following system should future automated Play Mode tests use?

## Tags, Contacts, And Validation

11. What exact heuristics define auto `loop` tagging?
    - Proposed: first/last pose similarity + stable root speed.

12. What exact role-detection heuristics are used for starts, stops, turns, jumps, and landings?

13. How should user-defined role vocabulary work?
    - Future workflow should allow adding project/character-specific roles.
    - Need schema for role display name, short description, grouping, and runtime/export behavior.
    - Role vocabularies should support load/save/share as portable JSON presets.
    - Need to decide whether character-local custom roles live inside `character.json` or beside it as a separate vocabulary file.
    - Custom roles should extend `clipRole`, not become tags.

14. How should auto-generated tags be represented differently from user-accepted/manual tags?
    - Need to avoid overwriting user intent on reimport.

15. Should foot contact visualization eventually become editable ranges in MVP+1?
    - MVP only visualizes.

16. How should height-based foot contact refinement work later?
    - User noted height is important, but velocity-only is acceptable for MVP.

17. What first set of guided retargeting problem categories should the future fix wizard support?

## UI And Workflow

18. How should the bottom timeline/log split resize?

19. What exact visual/content design should the first-run Create/Open Workspace screen use?

20. How should import progress and validation findings be surfaced without interrupting the workflow?

21. What is the exact UX for dirty/outdated Play Mode warning strip?

## Workspace And Packaging

22. Exact manifest property names and schema details need to be written.

23. Exact derived folder layout needs to be finalized.

24. Electron packaging is later; exact packaging strategy is open.

25. Should local machine settings live in `.motionlocal/settings.json` or a user config folder outside the workspace?
    - Decision so far: machine-local, not portable project state.

## Unity Compatibility

26. What minimum Unity-side manual setup is required to test exported databases quickly?

27. Which parts of `MotionMatchingData` must match the exported database for current deserialization assertions to pass?

28. How should Studio safely overwrite/update an existing Unity `.asset` descriptor outside Unity?
    - Desired workflow: direct overwrite/update of Unity asset parameters/features.
    - Need to account for Unity YAML serialization, GUID/fileID references, and what fields are safe to edit.

29. When should Unity descriptor generation/import be added?

## Security And Portability

30. What exact sensitive-data scanning command/checklist should be run before export/zip/commit?

31. Which workspace files should be included/excluded when creating a portable zip?
    - Decision so far: source assets and manifests yes; derived cache/builds no.
