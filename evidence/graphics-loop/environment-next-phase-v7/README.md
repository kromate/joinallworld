# Environment review fixture v7 — readiness control candidate

This isolated candidate contains the same production host, crowd, city, and scene graph as v6. Its only viewer runtime change removes `host.loop.running` from the readiness pending predicate; it still blocks active avatar movement and camera/scene easing. V4’s persisted Neighborhood receipt proves the render loop was active after easing/motion had stopped, which left the old waiter at zero stable observations.

A new CPU package must compile this exact v7 viewer before remote rendering; the successful v6 CPU artifact still contains the old predicate and must not be reused. Package-v3 and render-v5 are source-only and unexecuted.

This fixture remains synthetic and diagnostic. Its fallback public/authored market actors are not canonical appearance acceptance, and no visual-quality, production-size, phone, or performance gate is asserted here.
