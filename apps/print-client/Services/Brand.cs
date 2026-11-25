namespace MeuCardapio.PrintClient.Services
{
    // Marca (CL-05: o produto se chama "Vitry"). FONTE ÚNICA de tudo que o lojista LÊ: janela, bandeja, avisos e caixas de mensagem.
    // NÃO mudam com a marca (quebrariam quem já está instalado): a pasta de dados %LOCALAPPDATA%\MeuCardapioPrintClient (AppSettings),
    // a entropia do DPAPI (SecretStore: a chave de impressora salva deixaria de abrir), o mutex de instância única (SingleInstance,
    // o mesmo do AppMutex do instalador) e o AppId do instalador (a atualização reconhece a instalação anterior). Namespaces também ficam.
    public static class Brand
    {
        public const string Product = "Vitry";
        public const string AppTitle = "Vitry Impressão";
        public const string SetupTitle = "Vitry - Configuração inicial";
        public const string UserAgentProduct = "Vitry-PrintClient";
    }
}
