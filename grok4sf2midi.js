// JavaScript SoundFont 2 Parser and Player using Web Audio API
// Based on SoundFont 2.01 Technical Specification
// Expanded with stereo support, LFOs, modulation envelope, default modulators, more generators, and MIDI file parsing/playing.

function readString(view, offset, length) {
  let str = '';
  for (let i = 0;i < length;i++) {
    const char = view.getUint8(offset + i);
    if (char === 0) break;
    str += String.fromCharCode(char);
  }
  return str;
}

function readChunk(view, offset) {
  const id = readString(view, offset, 4);
  const size = view.getUint32(offset + 4, true);
  return {id, size, offset: offset + 8, end: offset + 8 + size};
}

function parseRIFF(view, offset = 0, end = view.byteLength) {
  const chunks = {};
  while (offset < end) {
    const chunk = readChunk(view, offset);
    if (chunk.id === 'RIFF' || chunk.id === 'LIST') {
      const formType = readString(view, chunk.offset, 4);
      chunks[formType] = parseRIFF(view, chunk.offset + 4, chunk.end);
    } else {
      chunks[chunk.id] = {dataOffset: chunk.offset, size: chunk.size};
    }
    offset = chunk.end + (chunk.size % 2);
  }
  return chunks;
}

class Sample {
  constructor(name, start, end, startLoop, endLoop, sampleRate, originalKey, correction, sampleLink, sampleType) {
    this.name = name;
    this.start = start;
    this.end = end;
    this.startLoop = startLoop;
    this.endLoop = endLoop;
    this.sampleRate = sampleRate;
    this.originalKey = originalKey;
    this.correction = correction;
    this.sampleLink = sampleLink;
    this.sampleType = sampleType;
  }
}

class Generator {
  constructor(op, amount) {
    this.op = op;
    this.amount = amount;
  }
}

class Zone {
  constructor(generators = [], modulators = []) {
    this.generators = generators;
    this.modulators = modulators;
    this.keyRange = {lo: 0, hi: 127};
    this.velRange = {lo: 0, hi: 127};
    this.sampleID = null;
    this.instrumentID = null;
  }
}

class Instrument {
  constructor(name, zones) {
    this.name = name;
    this.zones = zones;
  }
}

class Preset {
  constructor(name, program, bank, zones) {
    this.name = name;
    this.program = program;
    this.bank = bank;
    this.zones = zones;
  }
}

class SoundFontParser {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.riff = parseRIFF(this.view);
    this.samples = [];
    this.instruments = [];
    this.presets = [];
    this.sampleData = null;
    this.parse();
  }

  parse() {
    if (!this.riff.sfbk) throw new Error('Not a valid SF2 file');

    const sdta = this.riff.sfbk.sdta;
    if (sdta.smpl) {
      const smpl = sdta.smpl;
      const numSamples = smpl.size / 2;
      this.sampleData = new Int16Array(this.view.buffer, smpl.dataOffset, numSamples);
    }

    const pdta = this.riff.sfbk.pdta;

    const shdr = pdta.shdr;
    const numSamples = shdr.size / 46;
    for (let i = 0;i < numSamples;i++) {
      const off = shdr.dataOffset + i * 46;
      const name = readString(this.view, off, 20);
      const start = this.view.getUint32(off + 20, true);
      const end = this.view.getUint32(off + 24, true);
      const startLoop = this.view.getUint32(off + 28, true);
      const endLoop = this.view.getUint32(off + 32, true);
      const sampleRate = this.view.getUint32(off + 36, true);
      const originalKey = this.view.getUint8(off + 40);
      const correction = this.view.getInt8(off + 41);
      const sampleLink = this.view.getUint16(off + 42, true);
      const sampleType = this.view.getUint16(off + 44, true);
      this.samples.push(new Sample(name, start, end, startLoop, endLoop, sampleRate, originalKey, correction, sampleLink, sampleType));
    }

    const inst = pdta.inst;
    const numInst = inst.size / 22;
    const ibag = pdta.ibag;
    const igen = pdta.igen;
    const imod = pdta.imod; // ignore modulators for now, use defaults

    for (let i = 0;i < numInst - 1;i++) {
      const off = inst.dataOffset + i * 22;
      const name = readString(this.view, off, 20);
      const bagNdx = this.view.getUint16(off + 20, true);
      const nextBagNdx = this.view.getUint16(off + 20 + 22, true);
      const numZones = nextBagNdx - bagNdx;
      const zones = [];
      for (let z = 0;z < numZones;z++) {
        const bagOff = ibag.dataOffset + (bagNdx + z) * 4;
        const genNdx = this.view.getUint16(bagOff, true);
        const modNdx = this.view.getUint16(bagOff + 2, true);
        const nextGenNdx = this.view.getUint16(bagOff + 4, true);
        const numGens = nextGenNdx - genNdx;
        const generators = [];
        for (let g = 0;g < numGens;g++) {
          const genOff = igen.dataOffset + (genNdx + g) * 4;
          const op = this.view.getUint16(genOff, true);
          const amount = this.view.getInt16(genOff + 2, true);
          generators.push(new Generator(op, amount));
        }
        const zone = new Zone(generators);
        generators.forEach(gen => {
          if (gen.op === 43) zone.keyRange = {lo: gen.amount & 0xFF, hi: (gen.amount >> 8) & 0xFF};
          if (gen.op === 44) zone.velRange = {lo: gen.amount & 0xFF, hi: (gen.amount >> 8) & 0xFF};
          if (gen.op === 53) zone.sampleID = gen.amount;
        });
        zones.push(zone);
      }
      this.instruments.push(new Instrument(name, zones));
    }

    const phdr = pdta.phdr;
    const numPresets = phdr.size / 38;
    const pbag = pdta.pbag;
    const pgen = pdta.pgen;
    const pmod = pdta.pmod;

    for (let i = 0;i < numPresets - 1;i++) {
      const off = phdr.dataOffset + i * 38;
      const name = readString(this.view, off, 20);
      const program = this.view.getUint16(off + 20, true);
      const bank = this.view.getUint16(off + 22, true);
      const bagNdx = this.view.getUint16(off + 24, true);
      const nextBagNdx = this.view.getUint16(off + 24 + 38, true);
      const numZones = nextBagNdx - bagNdx;
      const zones = [];
      for (let z = 0;z < numZones;z++) {
        const bagOff = pbag.dataOffset + (bagNdx + z) * 4;
        const genNdx = this.view.getUint16(bagOff, true);
        const modNdx = this.view.getUint16(bagOff + 2, true);
        const nextGenNdx = this.view.getUint16(bagOff + 4, true);
        const numGens = nextGenNdx - genNdx;
        const generators = [];
        for (let g = 0;g < numGens;g++) {
          const genOff = pgen.dataOffset + (genNdx + g) * 4;
          const op = this.view.getUint16(genOff, true);
          const amount = this.view.getInt16(genOff + 2, true);
          generators.push(new Generator(op, amount));
        }
        const zone = new Zone(generators);
        generators.forEach(gen => {
          if (gen.op === 41) zone.instrumentID = gen.amount;
          if (gen.op === 43) zone.keyRange = {lo: gen.amount & 0xFF, hi: (gen.amount >> 8) & 0xFF};
          if (gen.op === 44) zone.velRange = {lo: gen.amount & 0xFF, hi: (gen.amount >> 8) & 0xFF};
        });
        zones.push(zone);
      }
      this.presets.push(new Preset(name, program, bank, zones));
    }
  }

  getZonesForNote(preset, key, velocity) {
    const matchingZones = [];
    preset.zones.forEach(zone => {
      if (key >= zone.keyRange.lo && key <= zone.keyRange.hi &&
        velocity >= zone.velRange.lo && velocity <= zone.velRange.hi) {
        if (zone.instrumentID !== null) {
          const inst = this.instruments[zone.instrumentID];
          inst.zones.forEach(instZone => {
            if (key >= instZone.keyRange.lo && key <= instZone.keyRange.hi &&
              velocity >= instZone.velRange.lo && velocity <= instZone.velRange.hi &&
              instZone.sampleID !== null) {
              matchingZones.push({zone: instZone, sample: this.samples[instZone.sampleID], presetZone: zone});
            }
          });
        }
      }
    });
    return matchingZones;
  }
}

function readVLQ(view, offset) {
  let value = 0;
  let bytes = 0;
  while (true) {
    const byte = view.getUint8(offset + bytes);
    value = (value << 7) + (byte & 0x7F);
    bytes++;
    if ((byte & 0x80) === 0) break;
  }
  return {value, bytes};
}

function parseMIDI(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 0;
  if (readString(view, 0, 4) !== 'MThd') throw new Error('Not a MIDI file');
  offset = 8;
  const format = view.getUint16(offset, false); offset += 2;
  const ntracks = view.getUint16(offset, false); offset += 2;
  const division = view.getUint16(offset, false); offset += 2;
  const tracks = [];
  for (let i = 0;i < ntracks;i++) {
    if (readString(view, offset, 4) !== 'MTrk') throw new Error('Bad track');
    offset += 4;
    const length = view.getUint32(offset, false); offset += 4;
    const trackEnd = offset + length;
    const track = [];
    let runningStatus = 0;
    while (offset < trackEnd) {
      const delta = readVLQ(view, offset); offset += delta.bytes;
      let status = view.getUint8(offset); offset++;
      if (status < 0x80) {
        offset--;
        status = runningStatus;
      } else {
        runningStatus = status;
      }
      let event = {delta: delta.value, status};
      if (status === 0xFF) {
        const type = view.getUint8(offset); offset++;
        const len = readVLQ(view, offset); offset += len.bytes;
        event.metaType = type;
        event.data = new Uint8Array(len.value);
        for (let j = 0;j < len.value;j++) {
          event.data[j] = view.getUint8(offset + j);
        }
        offset += len.value;
      } else if (status === 0xF0 || status === 0xF7) {
        const len = readVLQ(view, offset); offset += len.bytes;
        event.data = new Uint8Array(len.value);
        for (let j = 0;j < len.value;j++) {
          event.data[j] = view.getUint8(offset + j);
        }
        offset += len.value;
      } else {
        event.channel = status & 0x0F;
        event.type = status >> 4;
        if (event.type === 0xC || event.type === 0xD) {
          event.param1 = view.getUint8(offset); offset++;
        } else {
          event.param1 = view.getUint8(offset); offset++;
          event.param2 = view.getUint8(offset); offset++;
        }
      }
      track.push(event);
    }
    tracks.push(track);
    offset = trackEnd;
  }
  return {format, division, tracks};
}

class SoundFontPlayer {
  constructor(sfParser) {
    this.parser = sfParser;
    this.context = new (window.AudioContext || window.webkitAudioContext)();
  }

  applyEnvelope(param, startTime, delay, attack, hold, decay, sustain, release, isVolume = true) {
    const effectiveStart = startTime + (delay > 0 ? delay : 0);
    param.cancelScheduledValues(startTime);
    param.setValueAtTime(0, effectiveStart);
    param.linearRampToValueAtTime(1, effectiveStart + attack);
    param.setValueAtTime(1, effectiveStart + attack + hold);
    param.linearRampToValueAtTime(sustain, effectiveStart + attack + hold + decay);
    return (noteOffTime) => {
      param.cancelScheduledValues(noteOffTime);
      param.setValueAtTime(param.value, noteOffTime);
      param.linearRampToValueAtTime(0, noteOffTime + release);
    };
  }

  playNote(key, velocity, startTime, state) {
    const preset = this.parser.presets[state.preset]; // simplified, ignore bank
    const zones = this.parser.getZonesForNote(preset, key, velocity);
    if (zones.length === 0) return () => { };

    const stopFunctions = [];
    for (const {sample, zone, presetZone} of zones) {
      let effectiveGens = {};
      zone.generators.forEach(gen => effectiveGens[gen.op] = (effectiveGens[gen.op] || 0) + gen.amount);
      presetZone.generators.forEach(gen => effectiveGens[gen.op] = (effectiveGens[gen.op] || 0) + gen.amount);

      let rootKey = sample.originalKey;
      let fineTune = 0;
      let coarseTune = 0;
      let scaleTune = 100;
      let atten = 0;
      let pan = 0;
      let sampleModes = 0;
      let reverbSend = 0;
      let chorusSend = 0;
      let filterFc = 13500;
      let filterQ = 0;
      let modLfoToPitch = 0;
      let vibLfoToPitch = 0;
      let modEnvToPitch = 0;
      let modLfoToFilterFc = 0;
      let modEnvToFilterFc = 0;
      let modLfoToVolume = 0;
      let delayVolEnv = Math.pow(2, -12000 / 1200);
      let attackVolEnv = Math.pow(2, -12000 / 1200);
      let holdVolEnv = Math.pow(2, -12000 / 1200);
      let decayVolEnv = Math.pow(2, -12000 / 1200);
      let sustainVolEnv = 0;
      let releaseVolEnv = Math.pow(2, -12000 / 1200);
      let delayModEnv = Math.pow(2, -12000 / 1200);
      let attackModEnv = Math.pow(2, -12000 / 1200);
      let holdModEnv = Math.pow(2, -12000 / 1200);
      let decayModEnv = Math.pow(2, -12000 / 1200);
      let sustainModEnv = 1000;
      let releaseModEnv = Math.pow(2, -12000 / 1200);
      let delayModLfo = Math.pow(2, -12000 / 1200);
      let freqModLfo = 0;
      let delayVibLfo = Math.pow(2, -12000 / 1200);
      let freqVibLfo = 0;

      Object.keys(effectiveGens).forEach(op => {
        const amount = effectiveGens[op];
        switch (parseInt(op)) {
          case 0: sample.start += amount; break; // startAddrsOffset
          case 1: sample.end += amount; break; // endAddrsOffset
          case 2: sample.startLoop += amount; break; // startloopAddrsOffset
          case 3: sample.endLoop += amount; break; // endloopAddrsOffset
          case 4: sample.start += amount * 32768; break; // startAddrsCoarseOffset
          case 5: modLfoToPitch = amount; break;
          case 6: vibLfoToPitch = amount; break;
          case 7: modEnvToPitch = amount; break;
          case 8: filterFc = amount; break;
          case 9: filterQ = amount; break;
          case 10: modLfoToFilterFc = amount; break;
          case 11: modEnvToFilterFc = amount; break;
          case 12: sample.end += amount * 32768; break; // endAddrsCoarseOffset
          case 13: modLfoToVolume = amount; break;
          case 14: sample.startLoop += amount * 32768; break; // startloopAddrsCoarseOffset
          case 15: chorusSend = amount; break;
          case 16: reverbSend = amount; break;
          case 17: pan = amount; break;
          case 18: sample.endLoop += amount * 32768; break; // endloopAddrsCoarseOffset
          case 21: delayModLfo = Math.pow(2, amount / 1200); break;
          case 22: freqModLfo = amount; break;
          case 23: delayVibLfo = Math.pow(2, amount / 1200); break;
          case 24: freqVibLfo = amount; break;
          case 25: delayModEnv = Math.pow(2, amount / 1200); break;
          case 26: attackModEnv = Math.pow(2, amount / 1200); break;
          case 27: holdModEnv = Math.pow(2, amount / 1200); break;
          case 28: decayModEnv = Math.pow(2, amount / 1200); break;
          case 29: sustainModEnv = amount; break;
          case 30: releaseModEnv = Math.pow(2, amount / 1200); break;
          case 33: delayVolEnv = Math.pow(2, amount / 1200); break;
          case 34: attackVolEnv = Math.pow(2, amount / 1200); break;
          case 35: holdVolEnv = Math.pow(2, amount / 1200); break;
          case 36: decayVolEnv = Math.pow(2, amount / 1200); break;
          case 37: sustainVolEnv = amount; break;
          case 38: releaseVolEnv = Math.pow(2, amount / 1200); break;
          case 48: atten += amount / 10; break;
          case 51: coarseTune = amount; break;
          case 52: fineTune = amount; break;
          case 54: sampleModes = amount; break;
          case 56: scaleTune = amount; break;
          case 58: rootKey = amount; break;
          // More can be added if needed
        }
      });

      // Apply default modulators
      atten += 96 * (1 - Math.pow(velocity / 127, 2)); // vel to atten dB
      filterFc += -2400 * (1 - velocity / 127); // vel to filter cents
      vibLfoToPitch += 50 * (state.mod / 127); // mod wheel to vib depth
      atten += 96 * (1 - state.volume / 127); // CC7 to atten
      atten += 96 * (1 - state.expression / 127); // CC11 to atten
      pan += 1000 * (state.pan / 127 - 0.5); // CC10 to pan
      // Pitch bend: semitones = 2 * (state.pitchBend / 8192), add to semitones

      // Time fixes: assume typo, treat -1200 as min ~0
      const minTime = 0.001;
      delayVolEnv = Math.max(minTime, delayVolEnv);
      attackVolEnv = Math.max(minTime, attackVolEnv);
      // etc for others

      // Buffer with stereo support
      let numChannels = 1;
      let leftData, rightData, leftLoopStart, leftLoopEnd;
      let isStereo = false;
      if (sample.sampleType & 8 || sample.sampleType === 2 || sample.sampleType === 4) {
        let leftSample = sample;
        let rightSample = this.parser.samples[sample.sampleLink];
        if (sample.sampleType === 2) { // right
          rightSample = sample;
          leftSample = this.parser.samples[sample.sampleLink];
        }
        if (leftSample.sampleType === 4 && rightSample.sampleType === 2) {
          isStereo = true;
          numChannels = 2;
          const length = Math.min(leftSample.end - leftSample.start, rightSample.end - rightSample.start);
          leftData = new Float32Array(length);
          rightData = new Float32Array(length);
          for (let i = 0;i < length;i++) {
            leftData[i] = this.parser.sampleData[leftSample.start + i] / 32768;
            rightData[i] = this.parser.sampleData[rightSample.start + i] / 32768;
          }
          // Loop points, take from left
          leftLoopStart = leftSample.startLoop - leftSample.start;
          leftLoopEnd = leftSample.endLoop - leftSample.start;
        }
      }
      if (!isStereo) {
        const length = sample.end - sample.start;
        leftData = new Float32Array(length);
        for (let i = 0;i < length;i++) {
          leftData[i] = this.parser.sampleData[sample.start + i] / 32768;
        }
        leftLoopStart = sample.startLoop - sample.start;
        leftLoopEnd = sample.endLoop - sample.start;
      }
      const buffer = this.context.createBuffer(numChannels, leftData.length, sample.sampleRate);
      buffer.getChannelData(0).set(leftData);
      if (isStereo) buffer.getChannelData(1).set(rightData);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = (sampleModes === 1 || sampleModes === 3);
      if (source.loop) {
        source.loopStart = leftLoopStart / sample.sampleRate;
        source.loopEnd = leftLoopEnd / sample.sampleRate;
      }

      // Pitch
      const semitones = (key - rootKey) * (scaleTune / 100) + coarseTune + fineTune / 100 + sample.correction / 100;
      source.playbackRate.value = Math.pow(2, semitones / 12) * (sample.sampleRate / this.context.sampleRate);

      // Filter
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      const fcHz = 8.176 * Math.pow(2, filterFc / 1200);
      filter.frequency.value = Math.min(fcHz, this.context.sampleRate / 2);
      filter.Q.value = Math.pow(10, (filterQ / 10) / 20); // dB to Q approx

      // Gain
      const gainNode = this.context.createGain();
      // gainNode.gain.value = 1;//Math.pow(10, -atten / 20) * (velocity / 127);

      // Pan
      const panner = this.context.createStereoPanner();
      // panner.pan.value = 
      console.log(startTime);
      // Chain
      source.connect(this.context.destination);

      // Volume Envelope
      const sustainLevel = Math.pow(10, -sustainVolEnv / 200);
      const stopVolEnv = this.applyEnvelope(gainNode.gain, startTime, delayVolEnv, attackVolEnv, holdVolEnv, decayVolEnv, sustainLevel, releaseVolEnv);

      // Modulation Envelope
      const modEnvSource = this.context.createConstantSource();
      modEnvSource.start(startTime);
      const sustainModLevel = sustainModEnv / 1000;
      const stopModEnv = this.applyEnvelope(modEnvSource.offset, startTime, delayModEnv, attackModEnv, holdModEnv, decayModEnv, sustainModLevel, releaseModEnv, false);

      // Mod Env to Pitch
      const modEnvPitchGain = this.context.createGain();
      modEnvPitchGain.gain.value = modEnvToPitch;
      modEnvSource.connect(modEnvPitchGain);
      modEnvPitchGain.connect(source.detune);

      // Mod Env to Filter (approx)
      const modEnvFilterGain = this.context.createGain();
      modEnvFilterGain.gain.value = Math.log(2) / 1200 * modEnvToFilterFc * filter.frequency.value;
      modEnvSource.connect(modEnvFilterGain);
      modEnvFilterGain.connect(filter.frequency);

      // Mod LFO
      const modLFO = this.context.createOscillator();
      modLFO.type = 'triangle';
      modLFO.frequency.value = 8.176 * Math.pow(2, freqModLfo / 1200);
      modLFO.start(startTime + delayModLfo);

      // Mod LFO to Pitch
      const modLFOPitchGain = this.context.createGain();
      modLFOPitchGain.gain.value = modLfoToPitch;
      modLFO.connect(modLFOPitchGain);
      modLFOPitchGain.connect(source.detune);

      // Mod LFO to Volume (approx)
      const modLFOVolGain = this.context.createGain();
      modLFOVolGain.gain.value = (Math.log(10) / 20) * (modLfoToVolume / 10) * gainNode.gain.value;
      modLFO.connect(modLFOVolGain);
      modLFOVolGain.connect(gainNode.gain);

      // Mod LFO to Filter (approx)
      const modLFOFilterGain = this.context.createGain();
      modLFOFilterGain.gain.value = Math.log(2) / 1200 * modLfoToFilterFc * filter.frequency.value;
      modLFO.connect(modLFOFilterGain);
      modLFOFilterGain.connect(filter.frequency);

      // Vib LFO
      const vibLFO = this.context.createOscillator();
      vibLFO.type = 'triangle';
      vibLFO.frequency.value = 8.176 * Math.pow(2, freqVibLfo / 1200);
      vibLFO.start(startTime + delayVibLfo);

      // Vib LFO to Pitch
      const vibLFOPitchGain = this.context.createGain();
      vibLFOPitchGain.gain.value = vibLfoToPitch;
      vibLFO.connect(vibLFOPitchGain);
      vibLFOPitchGain.connect(source.detune);

      // Reverb and Chorus sends (simplified, no effects implemented)
      // Could add ReverbNode, but WebAudio has Convolver for reverb, skip for now

      // Start source
      source.start(startTime);

      // Stop function
      const stop = (noteOffTime) => {
        if (sampleModes !== 3) source.loop = false;
        stopVolEnv(noteOffTime);
        stopModEnv(noteOffTime);
        const endTime = noteOffTime + releaseVolEnv + 0.1;
        source.stop(endTime);
        modLFO.stop(endTime);
        vibLFO.stop(endTime);
        modEnvSource.stop(endTime);
      };
      stopFunctions.push(stop);
    }
    return (noteOffTime) => stopFunctions.forEach(stop => stop(noteOffTime));
  }

  async playMIDI(midiBuffer) {
    const midi = parseMIDI(midiBuffer);
    const events = [];
    midi.tracks.forEach(track => {
      let tick = 0;
      track.forEach(ev => {
        tick += ev.delta;
        events.push({tick, ...ev});
      });
    });
    events.sort((a, b) => a.tick - b.tick);

    let tempo = 500000;
    let lastTick = 0;
    let currentTime = this.context.currentTime;
    const activeNotes = Array.from({length: 16}, () => ({}));
    const channelState = Array.from({length: 16}, () => ({
      bank: 0, preset: 0, volume: 127, expression: 127, pan: 64, mod: 0, pitchBend: 0
    }));

    events.forEach(ev => {
      const deltaTick = ev.tick - lastTick;
      const deltaSec = (deltaTick / midi.division) * (tempo / 1000000);
      currentTime += deltaSec;
      lastTick = ev.tick;

      if (ev.metaType === 0x51 && ev.data.length === 3) {
        tempo = (ev.data[0] << 16) | (ev.data[1] << 8) | ev.data[2];
      } else if (ev.type === 0x9) { // note on
        const ch = ev.channel;
        const note = ev.param1;
        const vel = ev.param2;
        if (vel === 0) {
          const stop = activeNotes[ch][note];
          if (stop) stop(currentTime);
          delete activeNotes[ch][note];
        } else {
          const stop = this.playNote(note, vel, currentTime, channelState[ch]);
          activeNotes[ch][note] = stop;
        }
      } else if (ev.type === 0x8) { // note off
        const ch = ev.channel;
        const note = ev.param1;
        const stop = activeNotes[ch][note];
        if (stop) stop(currentTime);
        delete activeNotes[ch][note];
      } else if (ev.type === 0xB) { // controller
        const ch = ev.channel;
        const cc = ev.param1;
        const val = ev.param2;
        if (cc === 0) channelState[ch].bank = (channelState[ch].bank & 0x7F) | (val << 7);
        if (cc === 32) channelState[ch].bank = (channelState[ch].bank & 0x3F80) | val;
        if (cc === 7) channelState[ch].volume = val;
        if (cc === 10) channelState[ch].pan = val;
        if (cc === 11) channelState[ch].expression = val;
        if (cc === 1) channelState[ch].mod = val;
        // Ignore real-time changes for simplicity
      } else if (ev.type === 0xC) { // program change
        channelState[ev.channel].preset = ev.param1;
      } else if (ev.type === 0xE) { // pitch bend
        channelState[ev.channel].pitchBend = ((ev.param2 << 7) | ev.param1) - 8192;
        // Ignore for simplicity
      }
    });
  }
}

// Usage Example:
async function loadAndPlay() {
  const sf2Response = await fetch('GeneralUserGS.sf2'); // Replace
  const sf2Buffer = await sf2Response.arrayBuffer();
  const parser = new SoundFontParser(sf2Buffer);
  const player = new SoundFontPlayer(parser);

  const midiResponse = await fetch('song.mid'); // Replace with actual MIDI URL
  const midiBuffer = await midiResponse.arrayBuffer();
  player.playMIDI(midiBuffer);
}

window.onkeydown = loadAndPlay;
// Call loadAndPlay() to test.