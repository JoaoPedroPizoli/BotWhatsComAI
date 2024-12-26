import sys
import whisper


model = whisper.load_model('medium') # Usando o 'base' vai mais rapido, mas não é tão preciso!

def transcribe(audio_path):
    result = model.transcribe(audio_path, language='pt', fp16=False)
    print(result['text'])

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python transcribe.py <arquivo_de_audio>")
        sys.exit(1)
    audio_file = sys.argv[1]
    transcribe(audio_file)
