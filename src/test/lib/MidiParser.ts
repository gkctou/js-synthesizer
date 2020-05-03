import * as tsMidi from "midifile-ts";
import { Buffer as midiBuffer } from "./buffer";
import { MIDIControlEvents } from './MIDIControlEvents';

// check gm gs xg midi file
// https://fluid-dev.nongnu.narkive.com/LEJihMnU/code-patch-for-gm-gs-xg-system-reset-sysex-s-and-mastervolume-sysex
// https://www.midi.org/forum/3918-microsoft-gs-wavetable-synth-gm2
// http://www.jososoft.dk/yamaha/articles/midi_10.htm
// 1. GM Reset (understood by every GM-compatible instrument)
// Sys-Ex String: F0 7E 7F 09 01 F7
// 2. Roland GS Reset (Understood by all Roland GS instruments)
// Sys-Ex String: F0 41 10 42 12 40 00 7F 00 41 F7
// 3. Yamaha XG reset (Understood by all Yamaha XG instruments)
// Sys-Ex String: F0 43 10 4C 00 00 7E 00 F7
// 4. GM2 reset
// Sys-Ex String: F0 7E 7F 09 03 F7

// http://www.gnmidi.com/examples/midisummary/default.sysexdef
// ; do not modify this file, it will be overwritten by updates
// F0 7E 7F 09 01 F7 = GM Reset
// F0 7E 7F 09 02 F7 = GM Off
// F0 7E 7F 09 03 F7 = GM2 Reset
// F0 41 10 42 12 40 00 7F 00 41 F7 = GS Reset
// F0 43 10 4C 00 00 7E 00 F7 = XG Reset

// Table of MIDI patches (voices)
// http://eric.hurtebis.chez-alice.fr/patches/inst.htm
// http://midi.teragonaudio.com/tutr/bank.htm

// midi list with format
// http://eric.hurtebis.chez-alice.fr/midi2.htm

// Master Volume
// http://midi.teragonaudio.com/tech/midispec/mastrvol.htm
// This Universal SysEx message adjusts a device's master volume. Remember that in a multitimbral device, the Volume controller messages are used to control the volumes of the individual Parts. So, we need some message to control Master Volume. Here it is.
// 0xF0  SysEx
// 0x7F  Realtime
// 0x7F  The SysEx channel. Could be from 0x00 to 0x7F.
//       Here we set it to "disregard channel".
// 0x04  Sub-ID -- Device Control
// 0x01  Sub-ID2 -- Master Volume
// 0xLL  Bits 0 to 6 of a 14-bit volume
// 0xMM  Bits 7 to 13 of a 14-bit volume
// 0xF7  End of SysEx

//https://ccrma.stanford.edu/~craig/articles/linuxmidi/misc/essenmidi.html

export interface MidiInstrument {
    index?: number;
    channel: number;
    bankMsb: number;
    bankLsb: number;
    program: number;
    events: MidiEvent[];
}
export interface EventSwitch {
    meta?: true | 'setTempo' | 'trackName' | 'sequencerSpecific' | 'instrumentName' | 'timeSignature' | 'keySignature' | 'endOfTrack' | 'sequenceNumber' | 'text' | 'copyrightNotice' | 'lyrics' | 'marker' | 'cuePoint' | 'midiChannelPrefix' | 'portPrefix' | 'smpteOffset' | 'unknown';
    channel?: true | 'programChange' | 'controller' | 'noteOff' | 'noteOn' | 'noteAftertouch' | 'channelAftertouch' | 'pitchBend' | 'unknown';
    sysEx?: true | string;
    setInstrument?: true;
}
export interface MidiEvent {
    index?: number;
    track: number;
    instrument?: number;
    switch: EventSwitch;
    ticks: number;
    event: tsMidi.AnyEvent;
}
// ticks_per_quarter = <PPQ from the header>
// µs_per_quarter = <Tempo in latest Set Tempo event>
// µs_per_tick = µs_per_quarter / ticks_per_quarter
// ms_per_tick = µs_per_tick / 1.000
// seconds_per_tick = µs_per_tick / 1.000.000
export interface MidiSheet {
    reset?: 'GM' | 'GS' | 'XG' | 'GM2'
    trackName?: string;
    ticksPerBeat: number;
    sequence: MidiEvent[];
    firstTempo: number; //microsecondsPerBeat
    sequencerSpecific?: number[];
    instruments: MidiInstrument[];
}
export interface MidiParserOptions {
    logOff?: boolean;
}
/**
 * parse midi to typed data struct
 */
export function midiParser(midiFile: | DataView | number[] | ArrayBuffer | Buffer | Uint8Array, options: MidiParserOptions = {}): MidiSheet {
    const tsMidiFile = tsMidi.read(midiFile);
    const midiSheet: MidiSheet = {
        // reset: 'GM',
        // trackName: undefined,
        ticksPerBeat: tsMidiFile.header.ticksPerBeat,
        firstTempo: 0,
        // sequencerSpecific: undefined,
        sequence: [],
        instruments: []
    }
    let channelEvents: MidiEvent[][] = [];
    let channelInstruments: MidiInstrument[] = [];
    let instrumentDict: { [key: string]: MidiInstrument } = {};
    function setInstrument(channel: number, msb: number, lsb: number, program: number) {
        // TODO: 同一Channel轉換Program另開Instrumenet時可能需要保留programChange前的channel音效相關最後設定(volume,pan...),目前未實作。
        let insKey = `ins_${channel}_${msb}_${lsb}_${program}`;
        if (!instrumentDict[insKey]) {
            instrumentDict[insKey] = {
                // index: undefined,
                channel,
                bankMsb: msb,
                bankLsb: lsb,
                program,
                // 載入未設定Program前Channel events
                events: channelEvents[channel] || []
            }
            channelEvents[channel] = undefined;
        }
        // if (channelInstruments[e.channel] && channelInstruments[e.channel] != instrumentDict[insKey]) {
        //     console.warn(`channel ${e.channel} instrument change!`);
        // }
        channelInstruments[channel] = instrumentDict[insKey];
    }
    /**
     * 比較 large 陣列起始是否與 small 陣列一致, small[NaN,undefined] 代表不比較
     */
    function arrayCompare(large: number[], small: number[]): boolean {
        if (!large || !small) return false;
        if (large.length < small.length) return false;
        for (const [i, v] of small.entries()) {
            if (v === undefined || v === NaN) continue;
            if (large[i] !== v)
                return false;
        }
        return true;
    }
    for (const [ti, track] of tsMidiFile.tracks.entries()) {
        let bankMsb = 0, bankLsb = 0;
        let lastTicks = 0;
        for (const [i, e] of track.entries()) {
            let midiEvent = {
                // index: undefined,
                track: ti,
                // instrument: undefined,
                ticks: lastTicks + e.deltaTime,
                switch: {} as EventSwitch,
                event: e
            };
            midiSheet.sequence.push(midiEvent);
            switch (e.type) {
                case "meta":
                    const subtypeCode = tsMidi.MIDIMetaEvents[e.subtype]
                    if (subtypeCode === undefined)
                        break;
                    midiEvent.switch.meta = e.subtype;
                    switch (e.subtype) {
                        case "setTempo":
                            if (!midiSheet.firstTempo && e.microsecondsPerBeat)
                                midiSheet.firstTempo = e.microsecondsPerBeat;
                            break
                        case "trackName":
                            if (!midiSheet.trackName && e.text)
                                midiSheet.trackName = e.text;
                            break;
                        case "sequencerSpecific":
                            if (!midiSheet.sequencerSpecific && e.data)
                                midiSheet.sequencerSpecific = e.data;
                            break;
                        case "instrumentName":
                        case "timeSignature":
                        case "keySignature":
                            !options.logOff && console.log(`event-${e.type}-${e.subtype} should but not process.`);
                            break
                        case "endOfTrack":
                        case "sequenceNumber":
                        case "text":
                        case "copyrightNotice":
                        case "lyrics":
                        case "marker":
                        case "cuePoint":
                        case "midiChannelPrefix":
                        case "portPrefix":
                        case "smpteOffset":
                        case "unknown":
                        default:
                            !options.logOff && console.log(`event-${e.type}-${e.subtype} do not process.`);
                            break
                    }
                    break
                case "sysEx": //0xf0
                    midiEvent.switch.sysEx = true;
                    // F0 7E 7F 09 01 F7 = GM Reset
                    // F0 7E 7F 09 02 F7 = GM Off
                    // F0 7E 7F 09 03 F7 = GM2 Reset
                    // F0 41 10 42 12 40 00 7F 00 41 F7 = GS Reset
                    // F0 43 10 4C 00 00 7E 00 F7 = XG Reset
                    if (arrayCompare(e.data, [0x7E, 0x7F, 0x09, 0x01, 0xF7])) {
                        midiEvent.switch.sysEx = 'reset';
                        midiSheet.reset = 'GM';
                    } else if (arrayCompare(e.data, [0x7E, 0x7F, 0x09, 0x03, 0xF7])) {
                        midiEvent.switch.sysEx = 'reset';
                        midiSheet.reset = 'GM2';
                    } else if (arrayCompare(e.data, [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7F, 0x00, 0x41, 0xF7])) {
                        midiEvent.switch.sysEx = 'reset';
                        midiSheet.reset = 'GS';
                    } else if (arrayCompare(e.data, [0x43, 0x10, 0x4C, 0x00, 0x00, 0x7E, 0x00, 0xF7])) {
                        midiEvent.switch.sysEx = 'reset';
                        midiSheet.reset = 'XG';
                    } else if (e.data[0] === 0x43 && e.data[1] === 0x10 && e.data[2] === 0x4c && e.data[3] === 0x08 && e.data[7] === 0xf7) {
                        // set instrument
                        if (e.data[5] === 1 || e.data[5] === 2 || e.data[5] === 3) {
                            midiEvent.switch.sysEx = 'setInstrument';
                            midiEvent.switch.setInstrument = true;
                        }
                        // YAMAHA XG select bank & program http://www.studio4all.de/htmle/main92.html#xgprgxgpart02b
                        if (e.data[5] === 1) bankMsb = e.data[6];
                        else if (e.data[5] === 2) bankLsb = e.data[6];
                        else if (e.data[5] === 3)
                            setInstrument(e.data[4], bankMsb, bankLsb, e.data[6]);
                        else
                            !options.logOff && console.log(`instrument event-${e.type}-[${e.data.map(v => '0x' + v.toString(16)).join(', ')}] do not process.`);
                    } else {
                        !options.logOff && console.log(`event-${e.type}-[${e.data.map(v => '0x' + v.toString(16)).join(', ')}] do not process.`);
                    }
                    break
                case "dividedSysEx": //0xf7
                    // 切分封包的 SysEx 指令
                    // https://github.com/colxi/midi-parser-js/wiki/MIDI-File-Format-Specifications
                    midiEvent.switch.sysEx = 'divided';
                    !options.logOff && console.log(`event-${e.type} do not process.`);
                    break
                case "channel": {
                    const subtypeCode = tsMidi.MIDIChannelEvents[e.subtype]
                    if (subtypeCode === undefined)
                        break;
                    midiEvent.switch.channel = e.subtype;
                    switch (e.subtype) {
                        case "programChange":
                            setInstrument(e.channel, bankMsb, bankLsb, e.value);
                            midiEvent.switch.setInstrument = true;
                            break
                        case "controller":
                            if (e.controllerType === MIDIControlEvents.MSB_BANK) {
                                bankMsb = e.value;
                                // 若無設定 bankLsb 則預設為 0, 預設必定先傳MSB再傳LSB(或不傳)
                                bankLsb = 0;
                                midiEvent.switch.setInstrument = true;
                                break;
                            } else if (e.controllerType === MIDIControlEvents.LSB_BANK) {
                                bankLsb = e.value;
                                midiEvent.switch.setInstrument = true;
                                break;
                            }
                        case "noteOff":
                        case "noteOn":
                        case "noteAftertouch":
                        case "channelAftertouch":
                        case "pitchBend":
                            if (channelInstruments[e.channel])
                                channelInstruments[e.channel].events.push(midiEvent);
                            else {
                                channelEvents[e.channel] = channelEvents[e.channel] || [];
                                channelEvents[e.channel].push(midiEvent);
                            }
                            break;
                        case "unknown":
                        default:
                            !options.logOff && console.log(`event-${e.type}-${e.subtype} do not process.`);
                            break
                    }
                    break
                }
            }
            e.deltaTime && (lastTicks += e.deltaTime);
        }
    }
    midiSheet.sequence.sort((a, b) => a.ticks - b.ticks);
    midiSheet.sequence.forEach((v, i, a) => v.index = i);
    for (const key in instrumentDict) {
        if (instrumentDict.hasOwnProperty(key)) {
            midiSheet.instruments.push(instrumentDict[key]);
        }
    };
    midiSheet.instruments.forEach((v, i, a) => {
        v.index = i;
        v.events.forEach((vv, ii, aa) => vv.instrument = i);
    });
    // midiSheet['channelEvents'] = channelEvents;
    return midiSheet;
}
export interface MidiGroup {
    ticks: number;
    deltaTicks: number;
    deltaMilliseconds: number;
    events: MidiEvent[];
}
export interface MidiGroupOptions {
    logOff?: boolean;
}
/**
 * group sequence midi event in to group by mergeMilliseconds interval
 */
export function toMidiGroup({ sequence, ticksPerBeat, firstTempo }: MidiSheet, mergeMilliseconds: number = 4, options: MidiGroupOptions = {}): MidiGroup[] {
    let groupDict: { [ticks: string]: MidiGroup } = {};
    for (const midiEvent of sequence) {
        const k = `t${midiEvent.ticks}`;
        if (!groupDict[k])
            groupDict[k] = {
                ticks: midiEvent.ticks,
                deltaTicks: 0,
                deltaMilliseconds: 0,
                events: []
            };
        groupDict[k].events.push(midiEvent);
    }
    let groups: MidiGroup[] = [];
    for (const key in groupDict) {
        if (groupDict.hasOwnProperty(key)) {
            groups.push(groupDict[key]);
        }
    }
    groups.sort((a, b) => a.ticks - b.ticks);
    groups.forEach((v, i, a) => {
        if (!i) return;
        v.deltaTicks = v.ticks - a[i - 1].ticks;
    });
    // js getTime => milliseconds
    // ticks_per_quarter = <PPQ from the header>
    // µs_per_quarter = <Tempo in latest Set Tempo event>
    // µs_per_tick = µs_per_quarter / ticks_per_quarter
    // ms_per_tick = µs_per_tick / 1.000
    // seconds_per_tick = µs_per_tick / 1.000.000
    let ms_per_tick = firstTempo / ticksPerBeat / 1000;
    if (!mergeMilliseconds || mergeMilliseconds < 4) {
        if (mergeMilliseconds)
            !options.logOff && console.log('mergeMilliseconds < 4 wont merge anything!');
        groups.forEach((v, i, a) => {
            if (!i) {
                v.deltaMilliseconds = 0;
                return
            };
            let lastGroup = a[i - 1];
            for (const e of lastGroup.events) {
                if (e.event.type === 'meta' && e.event.subtype === 'setTempo')
                    ms_per_tick = e.event.microsecondsPerBeat / ticksPerBeat / 1000;
            }
            v.deltaMilliseconds = v.deltaTicks * ms_per_tick;
        });
        return groups;
    }
    let mergeGroups: MidiGroup[] = [];
    groups.forEach((v, i, a) => {
        if (!i) {
            mergeGroups[0] = v;
            return;
        }
        let lastGroup = mergeGroups[mergeGroups.length - 1];
        for (const e of lastGroup.events) {
            if (e.event.type === 'meta' && e.event.subtype === 'setTempo')
                ms_per_tick = e.event.microsecondsPerBeat / ticksPerBeat / 1000;
        }
        v.deltaTicks = v.ticks - lastGroup.ticks;
        v.deltaMilliseconds = v.deltaTicks * ms_per_tick;
        if (v.deltaMilliseconds < mergeMilliseconds) {
            !options.logOff && console.log(`merge ticks for ${v.deltaTicks} ticks, ${v.deltaMilliseconds} ms.`);
            lastGroup.events = lastGroup.events.concat(v.events);
        } else {
            mergeGroups.push(v);
        }
    });
    return mergeGroups;
}
export interface Format0Options {
    setInstrument?: boolean;
}
/**
 * merge mulit tracks midi file to format-0 single track midi file(bin array) with options(filter setInst events...)
 */
export function toFormat0({ sequence, ticksPerBeat }: MidiSheet, options: Format0Options = {}): Uint8Array {
    const buf = new midiBuffer();
    // header chunk
    buf.writeChunk("MThd", it => {
        it.writeInt16(0) // formatType
        it.writeInt16(1) // trackCount
        it.writeInt16(ticksPerBeat) // timeDivision
    });
    let endOfTrack: MidiEvent;
    // track chunk
    let filted = sequence.filter((v, i, a) => {
        if (v.switch.setInstrument) return !!options.setInstrument;
        if (v.switch.meta === 'endOfTrack') {
            if (!endOfTrack || v.ticks > endOfTrack.ticks)
                endOfTrack = v;
            return false
        }
        if (v.switch.meta === 'setTempo') return true;
        if (v.switch.channel) return true;
        if (v.switch.sysEx) return true;
        return false;
    });
    filted.push(endOfTrack);
    let evts = filted.map((v, i, a) => {
        if (i === 0) {
            v.ticks = 0;
            v.event.deltaTime = 0;
            return v.event;
        }
        v.event.deltaTime = v.ticks - a[i - 1].ticks;
        return v.event;
    });
    buf.writeChunk("MTrk", it => {
        for (const e of evts) {
            it.writeBytes(tsMidi.serialize(e))
        }
    });
    return buf.toBytes()
}

export interface MeanVelocityOptions {
    mergeMilliseconds?: number;
    cutLightestScale?: number;
    cutHeaviestScale?: number;
}
/**
 * get avage speed of key push
 */
export function getMeanVelocity(midi: MidiSheet, options: MeanVelocityOptions = {
    mergeMilliseconds: 2000,
    cutLightestScale: 0.3,
    cutHeaviestScale: 0.1
}): number {
    options = {
        mergeMilliseconds: 2000,
        cutLightestScale: 0.3,
        cutHeaviestScale: 0.1,
        ...options
    };
    const group = toMidiGroup(midi, options.mergeMilliseconds, { logOff: true });
    let sessionVel: number[] = [];
    for (const g of group) {
        let maxVel = 0;
        for (const noteOn of g.events.filter(v => v.switch.channel === 'noteOn')) {
            if (noteOn.event.type === 'channel' && noteOn.event.subtype === 'noteOn' && noteOn.event.velocity > maxVel)
                maxVel = noteOn.event.velocity;
        }
        sessionVel.push(maxVel);
    }
    const cuted = sessionVel.filter(v => !!v).sort().slice(Math.round(sessionVel.length * options.cutLightestScale), sessionVel.length - Math.round(sessionVel.length * options.cutHeaviestScale));
    return Math.round(cuted.reduce((p, c) => p + c, 0) / cuted.length);
}

export interface DynamicRangeOptions {
    cutLightestScale?: number;
    cutHeaviestScale?: number;
}
export function getDynamicRange(midi: MidiSheet, options: DynamicRangeOptions = {
    cutLightestScale: 0.01,
    cutHeaviestScale: 0.01
}): { min: number, max: number } {
    options = {
        cutLightestScale: 0.01,
        cutHeaviestScale: 0.01,
        ...options
    };
    let vels = getVelocityCounts(midi);
    let splits: number[] = [];
    for (const [v, c] of vels.entries()) {
        for (let i = 0; i < c; i++) {
            splits.push(v);
        }
    }
    let sorted: number[] = splits.sort().slice(Math.round(splits.length * options.cutLightestScale), splits.length - Math.round(splits.length * options.cutHeaviestScale));
    return { min: sorted.shift(), max: sorted.pop() };
}

export function getVelocityCounts(midi: MidiSheet): number[] {
    let velocities: number[] = [...new Array<number>(128).keys()].map(v => 0);
    midi.sequence.forEach(v => {
        if (v.switch.channel === 'noteOn' && v.event.type === 'channel' && v.event.subtype === 'noteOn' && v.event.velocity > 0)
            velocities[v.event.velocity] += 1;
    });
    return velocities;
}
function linearUp(srcMainVel: number, srcSideVel: number, targetMainVel: number, targetSideVel: number, srcCurrent: number): number {
    const srcDiff = (srcSideVel - srcMainVel) || 1;
    const tarDiff = (targetSideVel - targetMainVel) || 1;
    const vel = Math.round(targetMainVel + (srcCurrent - srcMainVel) * tarDiff / srcDiff);
    return vel > 127 ? 127 : vel < 1 ? 1 : vel
}
function linearDown(srcMainVel: number, srcSideVel: number, targetMainVel: number, targetSideVel: number, srcCurrent: number): number {
    const srcDiff = (srcMainVel - srcSideVel) || 1;
    const tarDiff = (targetMainVel - targetSideVel) || 1;
    const vel = Math.round(targetMainVel - (srcMainVel - srcCurrent) * tarDiff / srcDiff);
    return vel > 127 ? 127 : vel < 1 ? 1 : vel
}
export interface VelocityMapOptions {
    mainVelocity?: number;
    dynamicMin?: number;
    dynamicMax?: number;
}
export function getVelocityMap(midi: MidiSheet, options: VelocityMapOptions = {
    mainVelocity: 64,
    dynamicMin: 22,
    dynamicMax: 88
}): number[] {
    options = {
        mainVelocity: 64,
        dynamicMin: 22,
        dynamicMax: 88,
        ...options
    };
    let srcMainVel = getMeanVelocity(midi);
    let srcDynamic = getDynamicRange(midi);
    return [...new Array(129).keys()].map((v, i, a) => {
        if (!i)
            return 0;
        else if (i < srcMainVel)
            return linearDown(srcMainVel, srcDynamic.min, options.mainVelocity, options.dynamicMin, i);
        else if (i > srcMainVel)
            return linearUp(srcMainVel, srcDynamic.max, options.mainVelocity, options.dynamicMax, i);
        else
            return options.mainVelocity;
    });
}