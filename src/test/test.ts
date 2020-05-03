// Prepare the AudioContext instance
const Speaker = require('speaker');
const {
    StreamAudioContext: NodeAudioContext
    // WebAudioContext, OfflineAudioContext
} = require('./lib/web-audio-engine');

const context = new NodeAudioContext({
    channels: 2,          // 2 channels
    bitDepth: 16,         // 16-bit samples
    blockSize: 512,
    // blockSize: 1024,
    sampleRate: 44100     // 44,100 Hz sample rate
    // sampleRate: 22050     // 44,100 Hz sample rate
});
const speaker = new Speaker({
    channels: context.format.numberOfChannels,
    bitDepth: context.format.bitDepth,
    sampleRate: context.sampleRate
    // device: 'hw:1,0' //'Jabra Link 370' // MAC OSX cli=> system_profiler SPAudioDataType
});
context.pipe(speaker);
// Start to render audio
context.resume();

import * as fs from 'fs';
import * as path from 'path';
import * as JSSynth from '../main/';

import { midiParser, toMidiGroup } from './lib/MidiParser';
import { MIDIControlEvents } from './lib/MIDIControlEvents';

async function sleep(ms = 0) {
    return new Promise(r => setTimeout(r, ms));
}

(async function () {
    await JSSynth.waitForReady();
    var synth = new JSSynth.Synthesizer();
    synth.init(context.sampleRate, {
        midiBankSelect: 'gm', //'gm' | 'gs' | 'xg' | 'mma';
        chorusActive: false,
        reverbActive: false,
        initialGain: 1
    });

    // Create AudioNode (ScriptProcessorNode) to output audio data
    var node = synth.createAudioNode(context, 1024); // 8192 is the frame count of buffer
    node.connect(context.destination);

    // synth.render(speaker);

    // const smfBuffer = fs.readFileSync(path.resolve(__dirname, '../midi/chpn-p15.mid'));
    const smfBuffer = fs.readFileSync(path.resolve(__dirname, './res/chpn_op66.mid'));

    // const sfontBuffer = fs.readFileSync(path.resolve(__dirname, '../sf2/FMPiano.sf2'));
    // const sfontBuffer = fs.readFileSync('/Volumes/JetDriver/MusicSoftware/SF2/FluidR3_GM/FluidR3_GM.sf2');
    const sfontBuffer = fs.readFileSync(path.resolve(__dirname, './res/Pianoset.sf2'));
    const sfontBuffer2 = fs.readFileSync(path.resolve(__dirname, './res/VelocityGrandPiano.sf2'));

    // Load your SoundFont data (sfontBuffer: ArrayBuffer)
    const sfId = await synth.loadSFont(sfontBuffer.buffer, 'Pianoset.sf2');
    const sfId2 = await synth.loadSFont(sfontBuffer2.buffer, 'VelocityGrandPiano.sf2');
    synth.setSFontBankOffset(sfId2, 1);
    console.log('getSFonts', JSON.stringify(await synth.getSFonts(), null, 4));
    console.log(`getPresets SF${sfId}:`, JSON.stringify(await synth.getPresets(sfId), null, 4));
    console.log(`getPresets SF${sfId2}:`, JSON.stringify(await synth.getPresets(sfId2), null, 4));
    process.exit(0);
    // const smfMode = false; // true; //
    // if (smfMode) {
    //     synth.hookPlayerMIDIEvents((_synth, _type, _midiEvent, _param): boolean => {
    //         return false;
    //     }, { count: 1 });
    //     try {
    //         // Load your SMF file data (smfBuffer: ArrayBuffer)
    //         await synth.addSMFDataToPlayer(smfBuffer.buffer);
    //         // Play the loaded SMF data
    //         await synth.playPlayer();
    //         // Wait for finishing playing
    //         await synth.waitForPlayerStopped();
    //         // Wait for all voices stopped
    //         await synth.waitForVoicesStopped();
    //         // Releases the synthesizer
    //         synth.close();
    //     } catch (err) {
    //         console.log('Failed:', err);
    //         // Releases the synthesizer
    //         synth.close();
    //     }
    // } else {
    //     const midi = midiParser(smfBuffer);
    //     const group = toMidiGroup(midi);
    //     for (const [i, g] of group.entries()) {
    //         if (g.deltaMilliseconds)
    //             await sleep(g.deltaMilliseconds);
    //         for (const e of g.events.filter(v => v.switch.channel || v.switch.sysEx)) {
    //             if (e.event.type === 'channel') {
    //                 switch (e.event.subtype) {
    //                     case 'noteOn':
    //                         // console.log(e.event.noteNumber);
    //                         if (e.event.velocity > 0)
    //                             synth.midiNoteOn(e.event.channel, e.event.noteNumber, e.event.velocity);
    //                         else
    //                             synth.midiNoteOff(e.event.channel, e.event.noteNumber);
    //                         break;
    //                     case 'noteOff':
    //                         synth.midiNoteOff(e.event.channel, e.event.noteNumber);
    //                         break;
    //                     case 'controller':
    //                         e.event.controllerType === MIDIControlEvents.MSB_BANK && (e.event.value = 0);
    //                         e.event.controllerType === MIDIControlEvents.LSB_BANK && (e.event.value = 0);
    //                         synth.midiControl(e.event.channel, e.event.controllerType, e.event.value);
    //                         break;
    //                     case 'programChange':
    //                         e.event.value = 0;
    //                         synth.midiProgramChange(e.event.channel, e.event.value);
    //                         break;
    //                     case 'pitchBend':
    //                         synth.midiPitchBend(e.event.channel, e.event.value);
    //                         break;
    //                     case 'noteAftertouch':
    //                         synth.midiKeyPressure(e.event.channel, e.event.noteNumber, e.event.amount);
    //                         break;
    //                     case 'channelAftertouch':
    //                         synth.midiChannelPressure(e.event.channel, e.event.amount);
    //                         break;
    //                     case 'unknown':
    //                     default:
    //                         console.log(`lose midi channel event ${e.event.type}-${e.event.subtype}`);
    //                         break;
    //                 }
    //             }
    //             else if (e.event.type === 'sysEx') {
    //                 synth.midiSysEx(new Uint8Array(e.event.data));
    //             }
    //         }
    //     }
    // }
})();

