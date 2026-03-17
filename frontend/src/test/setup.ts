import '@testing-library/jest-dom/vitest';

// @ts-expect-error: IS_REACT_ACT_ENVIRONMENT is not in the global type definitions
global.IS_REACT_ACT_ENVIRONMENT = true;
