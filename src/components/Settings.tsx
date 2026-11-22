import {useState} from 'react';
import {theme} from '../theme-runtime';
import type {ThemePreference} from '../theme';
import CompanionPanel from '../companion/CompanionPanel';
import type {CompanionController} from '../companion/useCompanion';
export default function Settings({companion}:{companion?:CompanionController}) {
 const [value,setValue]=useState(theme.get),[error,setError]=useState(false);
 return <><section aria-labelledby="appearance-heading"><h2 id="appearance-heading">Appearance</h2><label className="field-label" htmlFor="theme">Theme</label><select id="theme" value={value} aria-describedby="theme-help" onChange={e=>{const next=e.target.value as ThemePreference;setValue(next);setError(!theme.set(next));}}><option value="system">System Default</option><option value="light">Light</option><option value="dark">Dark</option></select><p className="field-help" id="theme-help">System Default follows your Windows appearance. Native dialogs and title bars use Windows settings.</p>{error && <p role="alert" className="selection-error">Theme applied for this session, but the preference could not be saved.</p>}</section>{companion&&<CompanionPanel controller={companion}/>}</>;
}
