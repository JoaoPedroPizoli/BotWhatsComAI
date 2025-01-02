import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
//import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { BaseDocumentLoader } from "langchain/document_loaders/base";
import path from "node:path"
import { CharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { TextLoader } from "langchain/document_loaders/fs/text";


export class AgenteHumanizador {
    constructor(model,input,chunkSize,chunkOverlap,searchType = "similarity",kDocuments){
        this.model = model
        this.input = input
        this.chunkSize = chunkSize
        this.chunkOverlap = chunkOverlap
        this.searchType = searchType
        this.kDocuments = kDocuments
    }

     async init(){
        this.initChatModel()
        await this.loadDocuments()
        await this.splitDocuments()
        this.selectEmbedding = new OllamaEmbeddings({ model: "mxbai-embed-large",baseUrl:'http://172.16.5.57:11434'})
        await this.createVectorStore()
        this.createRetriever()
        this.chain = await this.createChain()
        return this 
    }

    async initChatModel(){
        console.log('Carregando o Modelo...')
        this.llm = new Ollama({
            model: this.model,
            baseUrl:'http://172.16.5.57:11434',
        })
  }
  
  async loadDocuments(){
    console.log('Carregando Documentos...')
    const txtLoader = new TextLoader(path.join(import.meta.dirname, this.input))
    this.documents = await txtLoader.load()
  }

  async splitDocuments(){
    console.log('Splitando os documentos...')

    const textSplitter = new CharacterTextSplitter({
        separator: " ",
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap
    })
    this.texts = await textSplitter.splitDocuments(this.documents)

  }

  async createVectorStore(){
    console.log('Criando embeddings do documento...')
    this.db = await MemoryVectorStore.fromDocuments(this.texts, this.selectEmbedding)
  }

  createRetriever(){
    console.log('Inicializando o Vector Store Retreiever...')
    this.retriever = this.db.asRetriever({
        k: this.kDocuments,
        searchType: this.searchType
    })
  }

  async createChain(){
    console.log('Criando Retrieval QA chain...')
  
    const systemPrompt = `
### Instruções:
Você é um assistente que recebe:
1) Terá acesso a um contexto externo que te ajudará a moldar su comportamento (RAG)
2) A pergunta original do usuário (intenção e contexto).
3) Os dados brutos retornados pela consulta SQL (resultado efetivo do banco de dados).

Seu objetivo:
- Fornecer uma resposta sucinta, objetiva e “humanizada”,
- Que atenda à pergunta original do usuário,
- E apresente uma breve análise dos dados retornados.

Regras Gerais:
- Não invente nem incremente dados nas suas respostas e análises
- Use apenas os Dados que receber do dos Dados retornados da Query {dados}
- Não crie comparações que não exitam/não se relacionem
- Se baseie no contexto exeterno(RAG) para moldar seu comportamento 
- Se forem fornecidas métricas (ex.: produção, perdas), destaque-as brevemente.
- Mantenha a resposta curta: até 2 ou 3 parágrafos, preferencialmente.
- Use linguagem clara, amigável e profissional. 
- Evite jargões e termos técnicos em excesso.


### Input:

Contexto externo (informações do RAG): {context}
Usuário: {input}
Dados Retornados da Query: {dados}

### Resposta:
Retorne apenas o texto final, “humanizado”.
Não inclua explicações sobre seu raciocínio passo a passo.
`;

const prompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(systemPrompt),
  HumanMessagePromptTemplate.fromTemplate(
    `Contexto da view (informações do RAG): {context}  
     Pergunta do Usuário: {input}  
     Dados retornados da Query: {dados}`
  ),
]);
  
    const combineDocsChain = await createStuffDocumentsChain({
        llm: this.llm,
        prompt
    })
  
    const chain = await createRetrievalChain({
        combineDocsChain,
        retriever: this.retriever
    })
    
    return chain 
  }
  
  queryChain(){
    return this.chain
  }

}







