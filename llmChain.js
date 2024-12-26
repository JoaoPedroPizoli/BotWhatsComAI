import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
import { BaseDocumentLoader } from "langchain/document_loaders/base";
import path from "node:path"
import { CharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { TextLoader } from "langchain/document_loaders/fs/text";


export class AgenteQA {
    constructor(model,pdfDocument,chunkSize,chunkOverlap,searchType = "similarity",kDocuments){
        this.model = model
        this.pdfDocument = pdfDocument
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
    const txtLoader = new TextLoader(path.join(import.meta.dirname, this.pdfDocument))
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
  Você é um assistente especializado em SQL para Oracle SQL Developer.
  Seu papel é gerar exclusivamente um único comando SQL válido, sem explicações extras e sem ponto e vírgula ao final.
  Você terá acesso a um contexto externo (RAG) que fornece detalhes da view, colunas, tipos de dados, valores possíveis.
  Use estritamente as informações do contexto para gerar a query correta.
  Não explique seu raciocínio, apenas retorne o comando final.
  
  - Leia cuidadosamente a pergunta (input do usuário) e o contexto da view (RAG) palavra por palavra.
  - Caso precise criar qualquer cálculo (por exemplo, razões), lance o numerador para FLOAT.
  - Utilize aliases de tabelas se necessário.
  - Não inclua ponto e vírgula no final da query
  
  ### Input:
  Contexto da View (informações do RAG): {context}  
  Usuário: {input}
  
  ### Resposta:
  Retorne apenas a query SQL final (sem explicações, sem ponto e vírgula no final).
  `;
  
    const prompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(systemPrompt),
        HumanMessagePromptTemplate.fromTemplate(`Contexto da View (informações do RAG):{context}  Usuário:{input}`)
    ])
  
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








