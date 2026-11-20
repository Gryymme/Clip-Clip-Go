import { useReducer, useRef, useState } from 'react';
import Settings from './components/Settings';
import Converter from './converter/Converter';
import ImagesToPdf from './converter/ImagesToPdf';
import AppShell from './components/AppShell';
import { pages, isConversionPage, type PageName } from './navigation';
import { JobStatus } from './converter/ConversionControls';
import { jobIsBusy } from './converter/conversion';
import { initialSelection, selectionReducer } from './converter/selection';
import { useConversion } from './converter/useConversion';

export default function App() {
  const [activePage, setActivePage] = useState<PageName>('Converter');
  const [selection, dispatchSelection] = useReducer(selectionReducer, initialSelection);
  const selectionBusy = useRef(false);
  // Lives above page destinations: switching pages never resets either workflow.
  const conversion = useConversion(selection, dispatchSelection, activePage === 'Images to PDF');
  const page = pages.find(page => page.name === activePage)!;
  return <AppShell activePage={activePage} onNavigate={setActivePage}>
    {activePage === 'Converter' ? <Converter state={selection} dispatch={dispatchSelection} busy={selectionBusy} conversion={conversion} />
      : activePage === 'Images to PDF' ? <ImagesToPdf conversion={conversion} selecting={selection.selecting} />
      : activePage === 'Settings' ? <Settings /> : <section className="placeholder" aria-labelledby="placeholder-title"><h2 id="placeholder-title">Not implemented yet</h2><p>{page.description}</p></section>}
    {!isConversionPage(activePage) && jobIsBusy(conversion.job) && <JobStatus controller={conversion} />}
  </AppShell>;
}
