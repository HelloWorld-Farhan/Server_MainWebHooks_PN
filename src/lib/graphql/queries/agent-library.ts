export const AGENT_LIBRARY_LIST_QUERY = `
  query AgentLibraryList {
    agentLibrary {
      list {
        id
        slug
        name
        profile
        category
        useCases
        defaultType
        estimatedSetupMinutes
        samplePrompt
        defaultFirstMessage
        defaultVariables
        compatibleVoices
        demoAudioUrl
        avatarGradient
        sortOrder
      }
    }
  }
`;

export const AGENT_LIBRARY_BY_SLUG_QUERY = `
  query AgentLibraryBySlug($slug: String!) {
    agentLibrary {
      bySlug(slug: $slug) {
        id
        slug
        name
        profile
        category
        useCases
        defaultType
        estimatedSetupMinutes
        samplePrompt
        defaultFirstMessage
        defaultVariables
        compatibleVoices
        demoAudioUrl
        avatarGradient
        sortOrder
      }
    }
  }
`;

export type GraphQLAgentLibraryEntry = {
  id: string;
  slug: string;
  name: string;
  profile: string;
  category: string;
  useCases: string[];
  defaultType: string;
  estimatedSetupMinutes: number;
  samplePrompt: string;
  defaultFirstMessage: string;
  defaultVariables: {
    key: string;
    label: string;
    placeholder: string;
  }[];
  compatibleVoices: {
    id: string;
    name: string;
    provider: string;
  }[];
  demoAudioUrl: string;
  avatarGradient?: string | null;
  sortOrder: number;
};

export type AgentLibraryListResult = {
  agentLibrary: {
    list: GraphQLAgentLibraryEntry[];
  };
};

export type AgentLibraryBySlugResult = {
  agentLibrary: {
    bySlug: GraphQLAgentLibraryEntry | null;
  };
};
