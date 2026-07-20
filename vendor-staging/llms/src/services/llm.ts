import { ProviderService } from "./provider";
import {
  LLMProvider,
  RegisterProviderRequest,
  RequestRouteInfo,
} from "../types/llm";

export class LLMService {
  constructor(private readonly providerService: ProviderService) {
  }

  registerProvider(request: RegisterProviderRequest): LLMProvider {
    return this.providerService.registerProvider(request);
  }

  getProviders(): LLMProvider[] {
    return this.providerService.getProviders();
  }

  getProvider(id: string): LLMProvider | undefined {
    return this.providerService.getProvider(id);
  }

  updateProvider(
    id: string,
    updates: Partial<LLMProvider>
  ): LLMProvider | null {
    const result = this.providerService.updateProvider(id, updates);
    return result;
  }

  deleteProvider(id: string): boolean {
    const result = this.providerService.deleteProvider(id);
    return result;
  }

  toggleProvider(id: string, enabled: boolean): boolean {
    return this.providerService.toggleProvider(id, enabled);
  }

  private resolveRoute(modelName: string): RequestRouteInfo {
    const route = this.providerService.resolveModelRoute(modelName);
    if (!route) {
      throw new Error(
        `Model ${modelName} not found. Available models: ${this.getAvailableModelNames().join(
          ", "
        )}`
      );
    }
    return route;
  }

  async getAvailableModels(): Promise<any> {
    const providers = this.providerService.getAvailableModels();

    return {
      object: "list",
      data: providers.flatMap((provider) =>
        provider.models.map((model) => ({
          id: model,
          object: "model",
          provider: provider.provider,
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.provider,
        }))
      ),
    };
  }

  private getAvailableModelNames(): string[] {
    return this.providerService
      .getModelRoutes()
      .map((route) => route.fullModel);
  }

  getModelRoutes() {
    return this.providerService.getModelRoutes();
  }
}
