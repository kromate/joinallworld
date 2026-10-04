/** Original procedural assets. Import a domain entry directly for the smallest bundle. */
export { buildVehicle,poseVehicle,VEHICLE_TYPES,VEHICLE_DETAILS } from './vehicles/index.js';
export { buildPerson,buildAvatar,drawAvatar,normalizeLook,poseAvatar,LOOK_OPTIONS,DETAILS as PEOPLE_DETAILS,POSES } from './people/index.js';
export { buildEnvironment,poseEnvironment,ENVIRONMENT_TYPES,DETAILS as ENVIRONMENT_DETAILS } from './environment/index.js';
export { loadGeography,buildGeography,buildCountry,regionData,buildRoute,transitionCamera,GEOGRAPHY_LEVELS } from './geo/index.js';
