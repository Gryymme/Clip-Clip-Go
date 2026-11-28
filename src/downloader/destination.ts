import type {DownloadSettings} from './model';

interface Submission {inspectionId:number;settings:DownloadSettings;title:string;source:string;name:string}
export interface DownloadDestination {folder:string;name:string}

// Capture before the native dialog yields: later form edits must not change this job.
export async function selectDownloadOutput(
 input:Submission,
 choose:(suggested:string,format:string)=>Promise<DownloadDestination|null>,
){
 const snapshot=structuredClone(input);
 const destination=await choose(snapshot.name,snapshot.settings.format);
 return destination?{...snapshot,...destination}:null;
}
