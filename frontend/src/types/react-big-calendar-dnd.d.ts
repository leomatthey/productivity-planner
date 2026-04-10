/**
 * Type declaration for react-big-calendar DnD addon.
 *
 * This CJS module uses __esModule + exports.default, but Vite 8 (Rolldown)
 * ignores __esModule when the importer has "type": "module". We use namespace
 * import (import * as DnDAddon) and walk the .default chain at runtime.
 * This declaration types the module shape for TypeScript.
 */
declare module 'react-big-calendar/lib/addons/dragAndDrop' {
  import { ComponentType } from 'react'
  import { Calendar } from 'react-big-calendar'
  function withDragAndDrop(calendar: typeof Calendar): ComponentType<object>
  export default withDragAndDrop
}
