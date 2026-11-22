import { useEffect, useReducer, useRef, useState } from 'react';
import Downloader, { DownloadStatus } from './downloader/Downloader';
import { useDownloader } from './downloader/useDownloader';
import Settings from './components/Settings';
import {useCompanion} from './companion/useCompanion';
import Converter from './converter/Converter';
import MergePdf from './converter/MergePdf';
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
  const [downloadBusy, setDownloadBusy] = useState(false);
  // Lives above page destinations: switching pages never resets either workflow.
  const conversion = useConversion(selection, dispatchSelection, activePage === 'Images to PDF', downloadBusy);
  const download = useDownloader(Boolean(conversion.engine?.ready), conversion.starting || jobIsBusy(conversion.job));
  const companion=useCompanion();
  const browserAttempt=useRef<string|null>(null);
  useEffect(()=>{if(companion.status.candidate)setActivePage('Downloader');},[companion.status.candidate?.id]);
  useEffect(()=>{const candidate=companion.status.candidate;if(!candidate||browserAttempt.current===candidate.id||!download.capabilities||download.busy||download.otherBusy)return;browserAttempt.current=candidate.id;void download.inspectBrowser(candidate.id);},[companion.status.candidate?.id,download.capabilities,download.busy,download.otherBusy]);
  useEffect(() => setDownloadBusy(download.busy), [download.busy]);
  const page = pages.find(page => page.name === activePage)!;
  return <AppShell activePage={activePage} onNavigate={setActivePage}>
    {activePage === 'Downloader' ? <Downloader controller={download} companion={companion} onBrowserSetup={()=>setActivePage('Settings')} />
      : activePage === 'Converter' ? <Converter state={selection} dispatch={dispatchSelection} busy={selectionBusy} conversion={conversion} />
      : activePage === 'Images to PDF' ? <ImagesToPdf conversion={conversion} selecting={selection.selecting} />
      : activePage === 'Merge PDF' ? <MergePdf conversion={conversion} selecting={selection.selecting} />
      : activePage === 'Settings' ? <Settings companion={companion} /> : <section className="placeholder" aria-labelledby="placeholder-title"><h2 id="placeholder-title">Not implemented yet</h2><p>{page.description}</p></section>}
    {!isConversionPage(activePage) && jobIsBusy(conversion.job) && <JobStatus controller={conversion} />}
    {activePage !== 'Downloader' && download.busy && <DownloadStatus controller={download} />}
  </AppShell>;
}
