import pkg from 'whatsapp-web.js';
const { Client: WhatsAppClient, LocalAuth: WhatsAppLocalAuth } = pkg;
import oracledb from 'oracledb';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import https from 'https';
import NodeCache from 'node-cache';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { TextoAudio } from './tts.js'; 

import { AgenteQA } from './LLMs/llmChain.js'
import { AgenteHumanizador } from './LLMs/humanizador.js';

dotenv.config();
const txtHumanizador = "./DocsRAG/humanizador.txt"
const txtApontamento = "./DocsRAG/view_apontamentos.txt";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ffmpegPath = 'C:/ffmpeg/bin/ffmpeg.exe';
ffmpeg.setFfmpegPath(ffmpegPath);

const httpsAgent = new https.Agent({ keepAlive: true });
const axiosInstance = axios.create({ httpsAgent });

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const limit = pLimit(5);
const mensagensRespondidas = new Map();
const TEMPO_ARMAZENAMENTO = 5 * 60 * 1000; 

const userRequests = new Map(); 

async function initializeDBPool(retries = 5, delay = 5000) {
    try {
        await oracledb.initOracleClient({ libDir: 'C:/oracle/instantclient_23_6' });
        const pool = await oracledb.createPool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: process.env.DB_CONNECT_STRING,
        });
        console.log('✅ Pool de conexões Oracle criado com sucesso!');
        return pool;
    } catch (err) {
        console.error('❌ Erro ao inicializar o Oracle Client ou criar o pool:', err);
        if (retries > 0) {
            console.log(`🔄 Tentando reconectar em ${delay / 1000} segundos... (${retries} tentativas restantes)`);
            await new Promise(res => setTimeout(res, delay));
            return initializeDBPool(retries - 1, delay);
        } else {
            console.error('❌ Falha ao conectar ao banco de dados após várias tentativas. Encerrando o processo.');
            process.exit(1);
        }
    }
}

let pool = await initializeDBPool();

const audiosDir = path.resolve(__dirname, 'audios');
try {
    await fs.ensureDir(audiosDir);
    console.log(`📁 Diretório de áudios garantido em ${audiosDir}`);
} catch (err) {
    console.error('❌ Erro ao criar o diretório de áudios:', err);
    process.exit(1);
}

async function convertOggToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-f wav',
                '-acodec pcm_s16le',
                '-ar 16000',
                '-ac 1',
            ])
            .on('start', (cmd) => {
                console.log('🎬 Comando FFmpeg:', cmd);
            })
            .on('error', (err) => {
                console.error('❌ Erro ao converter o áudio:', err.message);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Áudio convertido para WAV.');
                resolve();
            })
            .save(outputPath);
    });
}

async function transcribeAudio(audioFilePath) {
    const cachedTranscription = cache.get(audioFilePath);
    if (cachedTranscription) {
        console.log(`🔄 Transcrição encontrada no cache para ${audioFilePath}`);
        return cachedTranscription;
    }

    return limit(() => new Promise((resolve, reject) => {
        const pythonScriptPath = path.resolve(__dirname, 'transcribe.py');
        const pythonInterpreter = path.resolve(__dirname, 'venv', 'Scripts', 'python.exe');
        const resolvedAudioFilePath = path.resolve(audioFilePath);
        console.log('📂 Caminho do interpretador Python:', pythonInterpreter);
        console.log('📂 Caminho do script Python:', pythonScriptPath);
        console.log('📂 Caminho do arquivo de áudio:', resolvedAudioFilePath);
        const args = [pythonScriptPath, resolvedAudioFilePath];

        execFile(pythonInterpreter, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ Erro ao transcrever o áudio:', error);
                return reject(error);
            }
            if (stderr) {
                console.error('⚠️  Erro ou Aviso na execução do script Python:', stderr);
            }
            const transcription = stdout.trim();
            cache.set(audioFilePath, transcription);
            resolve(transcription);
        });
    }));
}

async function executeQuery(query, params = {}) {
    let connection;
    try {
        console.log('🔗 Obtendo conexão do pool...');
        connection = await pool.getConnection();
        console.log('✅ Conexão obtida do pool.');
        console.log('🗄️ Executando a consulta...');
        const result = await connection.execute(query, params, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
        });
        console.log('✅ Consulta executada com sucesso!');
        return result.rows;
    } catch (err) {
        console.error('❌ Erro ao executar a consulta:', err);
        throw err;
    } finally {
        if (connection) {
            try {
                await connection.close();
                console.log('🔒 Conexão retornada ao pool.');
            } catch (err) {
                console.error('❌ Erro ao retornar a conexão ao pool:', err);
            }
        }
    }
}

function processUserMessage(iaResponse) {
    console.log('📝 Processando resposta da IA:', iaResponse);
    const query = iaResponse;
    const params = {};
    return { query, params };
}

async function respostaHumanizada(userMessage, respostaModelo) {
    try {
        console.log('🧠 Enviando mensagem para a IA Humanizadora de Dados...');
        const agenteHumanizado = await new AgenteHumanizador("qwen2.5:14b",txtHumanizador,1000,0,"similarity").init(); 
        const agenteHumanChain = agenteHumanizado.queryChain();
        const iaResponseHuman = await agenteHumanChain.invoke({input: userMessage, dados: respostaModelo});
        const iaResponseHumano = iaResponseHuman.answer;
        console.log(`🤖 Resposta da IA Humanizada: ${iaResponseHumano}`);
        return iaResponseHumano;
    } catch (error) {
        console.error('❌ Erro ao humanizar a resposta:', error);
        return '❌ Desculpe, ocorreu um erro ao processar sua mensagem.';
    }
}

const client = new WhatsAppClient({
    authStrategy: new WhatsAppLocalAuth(),
    puppeteer: {
        headless: false,
    },
});

client.on('qr', (qrCode) => {
    qrcode.generate(qrCode, { small: true });
    console.log('🔗 Escaneie o QR Code acima com o WhatsApp.');
});

client.on('ready', () => {
    console.log('✅ Bot WhatsApp pronto!');
});

client.on('message', async (msg) => {
    const userNumber = msg.from;
    let messageText = msg.body.trim().toLowerCase();
    if(msg){
        await client.sendMessage(
            msg.from, 
            '⏳ Gerando a consulta com AI, aguarde por favor!\n\n' +
            '- Para cancelar a requisição atual, digite e envie *CANCELAR* no chat.\n\n' +
            '- Para receber a resposta em Áudio (apenas áudio), escreva *$* antes de escrever a requisição.\n\n' +
            '- Para receber a resposta em Áudio e Texto, escreva *&* antes de escrever a requisição.'
        );
    }

    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    try {
        if (messageText === 'cancelar') {
            const userReqs = userRequests.get(userNumber) || [];
            if (userReqs.length > 0) {
                const lastRequest = userReqs[userReqs.length - 1];
                lastRequest.cancelRequested = true;
                console.log(`🚫 Cancelando a requisição ${lastRequest.requestId} do usuário ${userNumber}.`);
                await client.sendMessage(msg.from, '🚫 Sua última requisição foi cancelada.');
            } else {
                await client.sendMessage(msg.from, '❌ Não há requisição em andamento para cancelar.');
            }
            return;
        }

        const userReqs = userRequests.get(userNumber) || [];
        const currentRequest = {
            requestId,
            cancelRequested: false,
            queryInProgress: true
        };
        userReqs.push(currentRequest);
        userRequests.set(userNumber, userReqs);

        const msgId = msg.id._serialized;
        if (mensagensRespondidas.has(msgId)) {
            return;
        }
        mensagensRespondidas.set(msgId, Date.now());

        console.log(`📩 Mensagem recebida de ${msg.from}: ${msg.body}`);
        let userMessage = '';

        function checkCancel() {
            const updatedUserReqs = userRequests.get(userNumber) || [];
            const thisReq = updatedUserReqs.find(r => r.requestId === requestId);
            if (!thisReq || thisReq.cancelRequested) {
                return true;
            }
            return false;
        }

        function finalizeRequest() {
            const updatedUserReqs = userRequests.get(userNumber) || [];
            const newReqs = updatedUserReqs.filter(r => r.requestId !== requestId);
            userRequests.set(userNumber, newReqs);
        }

        if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
            const media = await msg.downloadMedia();
            const audioBuffer = Buffer.from(media.data, 'base64');
            const audioFileName = path.resolve(audiosDir, `${msg.id.id}.ogg`);
            await fs.writeFile(audioFileName, audioBuffer);
            console.log(`📁 Áudio salvo em ${audioFileName}`);

            if (checkCancel()) {
                console.log('🚫 A transcrição foi cancelada antes da conversão.');
                finalizeRequest();
                return;
            }

            const wavFileName = path.resolve(audiosDir, `${msg.id.id}.wav`);
            await convertOggToWav(audioFileName, wavFileName);

            if (checkCancel()) {
                await fs.remove(audioFileName);
                await fs.remove(wavFileName);
                console.log('🚫 A transcrição foi cancelada após a conversão.');
                finalizeRequest();
                return;
            }

            userMessage = await transcribeAudio(wavFileName);

            if (checkCancel()) {
                await fs.remove(audioFileName);
                await fs.remove(wavFileName);
                console.log('🚫 A transcrição foi cancelada após a transcrição.');
                finalizeRequest();
                return;
            }
            console.log(`📝 Transcrição da mensagem de áudio: ${userMessage}`);
            await fs.remove(audioFileName);
            await fs.remove(wavFileName);
            console.log('🗑️ Arquivos temporários removidos.');
        } else {
            userMessage = msg.body;
        }

        if (checkCancel()) {
            console.log('🚫 A requisição foi cancelada antes de gerar a query.');
            finalizeRequest();
            return;
        }

        let sendAudioOnly = false;
        let sendAudioAndText = false;

        if (userMessage.trim().startsWith('$')) {
            userMessage = userMessage.trim().substring(1).trim();
            sendAudioOnly = true;
        } else if (userMessage.trim().startsWith('&')) {
            userMessage = userMessage.trim().substring(1).trim();
            sendAudioAndText = true;
        }

        console.log('🤖 Enviando mensagem para a IA Geradora de Query...');
        const agenteAi = await new AgenteQA("qwen2.5-coder:32b", txtApontamento, 1000, 0, "similarity").init(); 
        const agenteAiChain = agenteAi.queryChain();
        const iaResponseTotal = await agenteAiChain.invoke({ input: userMessage });
        const iaResponse = iaResponseTotal.answer;

        if (checkCancel()) {
            console.log('🚫 A requisição foi cancelada antes de executar a consulta.');
            finalizeRequest();
            return;
        }

        if (iaResponse) {
            const { query, params } = processUserMessage(iaResponse);
            if (query) {
                try {
                    const rows = await executeQuery(query, params);

                    if (checkCancel()) {
                        console.log('🚫 A requisição foi cancelada antes de enviar a resposta.');
                        finalizeRequest();
                        return;
                    }

                    let respostaModelo = '';
                    if (rows.length > 0) {
                        respostaModelo = '📊 Resultados encontrados:\n';
                        rows.forEach((row) => {
                            respostaModelo += `${JSON.stringify(row)}\n`;
                        });
                    } else {
                        respostaModelo = '❌ Nenhum resultado encontrado para sua consulta.';
                    }

                    console.log('📊 Dados Brutos da Consulta:', respostaModelo);
                    const respostaHuman = await respostaHumanizada(userMessage, respostaModelo);

                    if (checkCancel()) {
                        console.log('🚫 A requisição foi cancelada antes de enviar resposta humanizada.');
                        finalizeRequest();
                        return;
                    }

                    
                    if (sendAudioOnly) {
                        TextoAudio(client,msg.from,respostaHuman);
                    }
                    else if (sendAudioAndText) {
                        await client.sendMessage(msg.from, respostaHuman);
                        TextoAudio(client,msg.from,respostaHuman);
                    }
                    else {
                        await client.sendMessage(msg.from, respostaHuman);
                    }

                    console.log(`✅ Resposta enviada para ${msg.from}`);
                } catch (dbError) {
                    console.error('❌ Erro ao executar a consulta no banco de dados:', dbError);
                    if (!checkCancel()) {
                        await client.sendMessage(msg.from, '❌ Desculpe, ocorreu um erro ao consultar o banco de dados.');
                    }
                }
            } else {
                if (!checkCancel()) {
                    await client.sendMessage(msg.from, '❌ Desculpe, não entendi sua solicitação.');
                }
            }
        } else {
            if (!checkCancel()) {
                await client.sendMessage(msg.from, '❌ Desculpe, ocorreu um erro ao processar sua mensagem.');
            }
            console.error('❌ Erro na resposta da API:', 'Resposta inválida da IA.');
        }

        finalizeRequest();

    } catch (error) {
        console.error('❌ Erro ao processar a mensagem:', error);
        const userReqs = userRequests.get(userNumber) || [];
        const thisReq = userReqs.find(r => r.requestId === requestId);
        if (thisReq && !thisReq.cancelRequested) {
            await client.sendMessage(msg.from, '❌ Desculpe, ocorreu um erro ao processar sua mensagem.');
        }
        const newReqs = (userRequests.get(userNumber) || []).filter(r => r.requestId !== requestId);
        userRequests.set(userNumber, newReqs);
    }
});


setInterval(() => {
    const agora = Date.now();
    for (const [msgId, timestamp] of mensagensRespondidas) {
        if (agora - timestamp > TEMPO_ARMAZENAMENTO) {
            mensagensRespondidas.delete(msgId);
        }
    }
}, TEMPO_ARMAZENAMENTO / 2);

client.initialize();
