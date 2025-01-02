import axios from 'axios';
import fs from 'node:fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
import ffmpeg from 'fluent-ffmpeg';

const { Client: WhatsAppClient, LocalAuth: WhatsAppLocalAuth, MessageMedia } = pkg;

// Para módulos ES, precisamos definir manualmente __filename e __dirname:
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @param {Object} client 
 * @param {string} chatId 
 * @param {string} textoParaFalar 
 */
export async function TextoAudio(client, chatId, textoParaFalar) {
  try {
    const ALLTALK_URL = 'http://172.16.5.57:7851';
    const textoComPausas = textoParaFalar.replace(/\./g, ';');

    const ttsPayload = new URLSearchParams();
    ttsPayload.append('text_input', textoComPausas);
    ttsPayload.append('text_filtering', 'standard');
    ttsPayload.append('character_voice_gen', 'male_03.wav');
    ttsPayload.append('narrator_enabled', 'false');
    ttsPayload.append('text_not_inside', 'character');
    ttsPayload.append('narrator_voice_gen', 'male_03.wav');
    ttsPayload.append('language', 'pt');
    ttsPayload.append('output_file_name', 'ttsaudio');
    ttsPayload.append('output_file_timestamp', 'true');
    ttsPayload.append('autoplay', 'false');
    ttsPayload.append('autoplay_volume', '1.0');

    const response = await axios.post(`${ALLTALK_URL}/api/tts-generate`, ttsPayload);

    if (response.data.status !== 'generate-success') {
      throw new Error('Falha ao gerar TTS: ' + JSON.stringify(response.data));
    }
    const outputFileUrl = response.data.output_file_url;
    console.log('Áudio gerado. URL:', outputFileUrl);

   
    const downloadResponse = await axios.get(outputFileUrl, {
      responseType: 'arraybuffer'
    });

    
    const audioDir = path.join(__dirname, 'audioTTS');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

   
    const wavFilePath = path.join(audioDir, 'ttsaudio.wav');
    fs.writeFileSync(wavFilePath, downloadResponse.data);
    console.log('Áudio (WAV) salvo em:', wavFilePath);


    const oggFilePath = path.join(audioDir, 'ttsaudio.ogg');

    //  Converte o .wav para .ogg (opus) usando ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(wavFilePath)
        .audioCodec('libopus')         // usa codec opus
        .audioBitrate('64k')          // taxa de bits (ajuste como preferir)
        .format('ogg')                // define o formato de saída
        .on('error', (err) => {
          console.error('Erro ao converter para .ogg:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('Conversão .wav -> .ogg finalizada.');
          resolve();
        })
        .save(oggFilePath);
    });

    // 7) Cria o objeto MessageMedia a partir do .ogg
    const base64Audio = fs.readFileSync(oggFilePath, 'base64');
    // Mimetype "audio/ogg; codecs=opus" garante envio como voz (PTT)
    const media = new MessageMedia('audio/ogg; codecs=opus', base64Audio, 'ttsaudio.ogg');

    // 8) Envia o arquivo .ogg como mensagem de voz (PTT) no WhatsApp
    await client.sendMessage(chatId, media, {
      sendAudioAsVoice: true   // true para enviar como Voice Note (PTT)
    });
    console.log('Áudio enviado para o WhatsApp como voz (PTT) com sucesso!');
    
  } catch (err) {
    if (err.response) {
      console.log('DETAIL:', err.response.data);
    }
    console.error('Erro ao processar TTS:', err);
  }
}
