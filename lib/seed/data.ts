export type SeedQuestion = {
  category: 'behavioral' | 'technical';
  text: string;
  difficulty: 1 | 2 | 3;
  followUpHints: string[];
};

export type SeedTopic = {
  topic: string;
  behavioral: Omit<SeedQuestion, 'category'>;
  technical: Omit<SeedQuestion, 'category'>;
};

export type SeedJob = {
  slug: string;
  title: string;
  description: string;
  seniority: string;
  competencies: string[];
  keyterms: string[];
  topics: SeedTopic[];
};

export const seedJobs: SeedJob[] = [
  {
    slug: 'frontend-engineer',
    title: 'Frontend Engineer',
    description:
      'Build fast, accessible, well-tested interfaces in React and TypeScript, and work closely with design and product.',
    seniority: 'Mid to senior',
    competencies: [
      'React and state management',
      'Performance',
      'TypeScript and API boundaries',
      'Accessibility',
      'Testing and quality',
      'Debugging',
      'Collaboration',
      'Ownership and delivery',
    ],
    keyterms: [
      'React',
      'TypeScript',
      'Next.js',
      'hooks',
      'Redux',
      'accessibility',
      'ARIA',
      'Lighthouse',
      'Core Web Vitals',
      'Jest',
      'Playwright',
    ],
    topics: [
      {
        topic: 'state_management',
        behavioral: {
          text: 'Tell me about a time state management in a front-end project got out of hand. What did you do about it?',
          difficulty: 2,
          followUpHints: [
            'What made it hard to reason about?',
            'What did you change, and how did you know it helped?',
          ],
        },
        technical: {
          text: 'How do you decide where state should live in a React app, and when would you reach for a global store?',
          difficulty: 2,
          followUpHints: ['Local vs lifted vs server state', 'Cost of a global store'],
        },
      },
      {
        topic: 'performance',
        behavioral: {
          text: 'Describe a time you improved the performance of a page or app. How did you know it was a problem, and how did you know you fixed it?',
          difficulty: 2,
          followUpHints: ['Which metric did you use?', 'What was the biggest single win?'],
        },
        technical: {
          text: 'A page feels slow on mid-range phones. How would you find the cause, and what would you try first?',
          difficulty: 2,
          followUpHints: ['Profiling tools', 'Bundle size vs rendering vs network'],
        },
      },
      {
        topic: 'typescript_and_apis',
        behavioral: {
          text: 'Tell me about a time a mismatch between the front end and an API caused a bug. How did you resolve it, and how did you stop it happening again?',
          difficulty: 2,
          followUpHints: ['Who owned the contract?', 'What tooling or tests did you add?'],
        },
        technical: {
          text: 'How do you use TypeScript to prevent bugs at the boundary between your UI and an API?',
          difficulty: 3,
          followUpHints: ['Runtime validation vs types', 'Generated clients and shared schemas'],
        },
      },
      {
        topic: 'accessibility',
        behavioral: {
          text: 'Tell me about a time you made a product more accessible, or found an accessibility problem late. What happened?',
          difficulty: 2,
          followUpHints: ['How did you find it?', 'What changed in your process afterwards?'],
        },
        technical: {
          text: 'How would you make a custom dropdown menu usable with a keyboard and a screen reader?',
          difficulty: 3,
          followUpHints: ['Roles and ARIA attributes', 'Focus management and key handling'],
        },
      },
      {
        topic: 'testing_and_quality',
        behavioral: {
          text: 'Tell me about a release you worked on that caused a problem for users. What happened next, and what changed afterwards?',
          difficulty: 2,
          followUpHints: ['How was it detected?', 'What did you add to prevent a repeat?'],
        },
        technical: {
          text: 'What do you test in a front-end feature, and at what level? Where do you draw the line?',
          difficulty: 2,
          followUpHints: ['Unit vs component vs end-to-end', 'What you deliberately do not test'],
        },
      },
      {
        topic: 'debugging',
        behavioral: {
          text: 'Walk me through the hardest front-end bug you have tracked down. How did you find it?',
          difficulty: 2,
          followUpHints: ['What did you rule out first?', 'What would have found it faster?'],
        },
        technical: {
          text: "Users report a button 'sometimes does nothing' in production, and you can't reproduce it. How do you investigate?",
          difficulty: 3,
          followUpHints: ['Logging and error reporting', 'Race conditions and browser differences'],
        },
      },
      {
        topic: 'collaboration',
        behavioral: {
          text: 'Tell me about a time you disagreed with a designer or product manager about how something should work. How did you handle it?',
          difficulty: 2,
          followUpHints: ['What was each side optimising for?', 'How did it end?'],
        },
        technical: {
          text: 'How do you work with designers so designs stay feasible and consistent in code, for example through components and design tokens?',
          difficulty: 2,
          followUpHints: ['Component libraries', 'Handling one-off design exceptions'],
        },
      },
      {
        topic: 'ownership_and_delivery',
        behavioral: {
          text: 'Describe a feature you owned end to end. What was the hardest decision, and what would you change now?',
          difficulty: 2,
          followUpHints: ['How did you manage scope?', 'How did you measure success?'],
        },
        technical: {
          text: 'You have two weeks to ship a feature that realistically needs two months. How do you scope and sequence it?',
          difficulty: 3,
          followUpHints: ['What you cut first', 'How you communicate the tradeoffs'],
        },
      },
    ],
  },
  {
    slug: 'data-analyst',
    title: 'Data Analyst',
    description:
      'Turn messy data into clear answers: write SQL, check data quality, design metrics and experiments, and explain findings to decision makers.',
    seniority: 'Mid level',
    competencies: [
      'SQL and data wrangling',
      'Data quality',
      'Metrics and KPIs',
      'Experimentation',
      'Data visualization',
      'Stakeholder communication',
      'Turning insight into action',
      'Automation and reproducibility',
    ],
    keyterms: [
      'SQL',
      'Python',
      'pandas',
      'Looker',
      'Tableau',
      'dbt',
      'A/B test',
      'p-value',
      'cohort',
      'retention',
      'KPI',
    ],
    topics: [
      {
        topic: 'sql_and_data_wrangling',
        behavioral: {
          text: "Tell me about the most complex dataset you've had to pull together. How did you approach it?",
          difficulty: 2,
          followUpHints: ['Where did the data come from?', 'What went wrong along the way?'],
        },
        technical: {
          text: 'You need the top 3 customers by revenue per region for the last quarter, but customers can have multiple orders and refunds. How would you write that in SQL, and what would you check?',
          difficulty: 3,
          followUpHints: ['Window functions', 'Handling refunds and duplicate rows'],
        },
      },
      {
        topic: 'data_quality',
        behavioral: {
          text: 'Tell me about a time you found a serious problem in the data after people were already using it. What did you do?',
          difficulty: 2,
          followUpHints: ['How did you communicate it?', 'How did you prevent it recurring?'],
        },
        technical: {
          text: 'How would you check a new data source before trusting it for reporting? What checks do you run?',
          difficulty: 2,
          followUpHints: ['Nulls, duplicates, ranges', 'Reconciling to a known total'],
        },
      },
      {
        topic: 'metrics_and_kpis',
        behavioral: {
          text: 'Describe a time you helped a team choose or define a metric. How did you decide?',
          difficulty: 2,
          followUpHints: ['What did you rule out, and why?', 'How was the metric used afterwards?'],
        },
        technical: {
          text: "Weekly active users dropped 15% overnight. Walk me through how you'd investigate.",
          difficulty: 3,
          followUpHints: [
            'Tracking changes vs real behaviour',
            'Segmenting by platform, region, cohort',
          ],
        },
      },
      {
        topic: 'experimentation',
        behavioral: {
          text: 'Tell me about an experiment or A/B test you ran or analysed. What did you learn, and what went wrong?',
          difficulty: 2,
          followUpHints: ['How was it designed?', 'What did the team decide?'],
        },
        technical: {
          text: 'An A/B test shows a 3% lift with p = 0.04 after two days. What do you do before recommending to ship?',
          difficulty: 3,
          followUpHints: ['Peeking and sample size', 'Practical vs statistical significance'],
        },
      },
      {
        topic: 'visualization',
        behavioral: {
          text: 'Tell me about a dashboard or chart you built that people actually used. What made it work?',
          difficulty: 1,
          followUpHints: ['Who was the audience?', 'What did you remove?'],
        },
        technical: {
          text: 'How do you choose between a line chart, a bar chart and a table for a given question? What mistakes do you avoid?',
          difficulty: 2,
          followUpHints: ['Truncated axes', 'Too many series or colours'],
        },
      },
      {
        topic: 'stakeholder_communication',
        behavioral: {
          text: 'Tell me about a time your analysis contradicted what a stakeholder expected. How did you handle it?',
          difficulty: 2,
          followUpHints: ['How did you present the evidence?', 'What was the outcome?'],
        },
        technical: {
          text: 'How do you explain uncertainty or a confidence interval to a non-technical executive?',
          difficulty: 2,
          followUpHints: ['A concrete analogy', 'What decision changes because of it'],
        },
      },
      {
        topic: 'insight_to_action',
        behavioral: {
          text: 'Describe an analysis that led to a concrete business decision. How did you get from data to action?',
          difficulty: 2,
          followUpHints: ['Who acted on it?', 'How did you know it worked?'],
        },
        technical: {
          text: "You've found that customers who use feature X churn less. How do you decide whether X actually causes the lower churn?",
          difficulty: 3,
          followUpHints: [
            'Selection bias and confounders',
            'What experiment or analysis would you run',
          ],
        },
      },
      {
        topic: 'tools_and_automation',
        behavioral: {
          text: 'Tell me about a manual reporting task you automated. What was the impact?',
          difficulty: 1,
          followUpHints: ['What tools did you use?', 'How did you check it stayed correct?'],
        },
        technical: {
          text: 'How do you make an analysis reproducible so a colleague can rerun it next quarter?',
          difficulty: 2,
          followUpHints: [
            'Version control and documented assumptions',
            'Parameterised queries or notebooks',
          ],
        },
      },
    ],
  },
  {
    slug: 'customer-success-manager',
    title: 'Customer Success Manager',
    description:
      'Own the relationship with a portfolio of customers: drive adoption, prevent churn, win renewals and expansions, and be their voice inside the company.',
    seniority: 'Mid level',
    competencies: [
      'Onboarding and adoption',
      'Retention and churn',
      'Renewals and expansion',
      'Escalation handling',
      'Stakeholder management',
      'Data and health scoring',
      'Cross-functional collaboration',
      'Prioritisation',
    ],
    keyterms: [
      'NPS',
      'QBR',
      'churn',
      'renewal',
      'upsell',
      'onboarding',
      'health score',
      'ARR',
      'Salesforce',
      'HubSpot',
      'Gainsight',
    ],
    topics: [
      {
        topic: 'onboarding_and_adoption',
        behavioral: {
          text: 'Tell me about a customer you onboarded who was slow to adopt the product. What did you do?',
          difficulty: 2,
          followUpHints: ['What was the root cause?', 'What changed adoption?'],
        },
        technical: {
          text: 'How would you design a 90-day onboarding plan for a new mid-market customer?',
          difficulty: 2,
          followUpHints: [
            'Milestones and success criteria',
            'Who you involve on the customer side',
          ],
        },
      },
      {
        topic: 'retention_and_churn',
        behavioral: {
          text: 'Describe a customer you thought would churn. What signals did you see, and what happened?',
          difficulty: 2,
          followUpHints: ['When did you first notice?', 'What would you do differently?'],
        },
        technical: {
          text: "A strong customer's usage has fallen 40% over two months. What do you do in the first week?",
          difficulty: 2,
          followUpHints: ['Diagnosing the cause', 'Who you talk to first'],
        },
      },
      {
        topic: 'renewals_and_expansion',
        behavioral: {
          text: "Tell me about a renewal or expansion you're proud of. How did you set it up?",
          difficulty: 2,
          followUpHints: ['When did you start the conversation?', 'What was the value story?'],
        },
        technical: {
          text: 'How do you decide when and how to raise expansion with a customer without damaging trust?',
          difficulty: 3,
          followUpHints: ['Signals of readiness', 'Working with the sales team'],
        },
      },
      {
        topic: 'escalations',
        behavioral: {
          text: 'Tell me about the most difficult escalation you handled. What was at stake, and how did it end?',
          difficulty: 2,
          followUpHints: ['How did you de-escalate?', 'What did you learn?'],
        },
        technical: {
          text: "A customer's executive sponsor writes an angry email about repeated outages. How do you respond in the first 24 hours?",
          difficulty: 3,
          followUpHints: [
            'Who you involve internally',
            'What you commit to, and what you avoid promising',
          ],
        },
      },
      {
        topic: 'stakeholder_management',
        behavioral: {
          text: 'Describe how you built a relationship with a senior executive at a customer.',
          difficulty: 2,
          followUpHints: ['What did they care about?', 'How did you stay relevant to them?'],
        },
        technical: {
          text: 'Your main contact at a customer leaves the company. How do you protect the account?',
          difficulty: 2,
          followUpHints: [
            'Multi-threading the relationship',
            'Re-establishing value with the new owner',
          ],
        },
      },
      {
        topic: 'data_and_health_scoring',
        behavioral: {
          text: 'Tell me about a time data changed how you managed an account.',
          difficulty: 2,
          followUpHints: ['Which data?', 'What action did you take?'],
        },
        technical: {
          text: 'What inputs would you include in a customer health score, and how would you check that it actually predicts churn?',
          difficulty: 3,
          followUpHints: [
            'Usage, support and sentiment signals',
            'Back-testing against past churn',
          ],
        },
      },
      {
        topic: 'cross_functional_collaboration',
        behavioral: {
          text: 'Tell me about a time you needed product or engineering to fix something for a customer. How did you get it prioritised?',
          difficulty: 2,
          followUpHints: ['How did you make the case?', 'What was the outcome for the customer?'],
        },
        technical: {
          text: 'How do you turn repeated customer feedback into a product request that gets taken seriously?',
          difficulty: 2,
          followUpHints: ['Evidence and revenue impact', 'Format of the request'],
        },
      },
      {
        topic: 'prioritization_and_time',
        behavioral: {
          text: 'How do you decide which accounts get your time when everything feels urgent? Give me an example.',
          difficulty: 2,
          followUpHints: ['What criteria do you use?', 'What did you decide not to do?'],
        },
        technical: {
          text: 'You manage 40 accounts and have 3 urgent issues, 2 renewals due this month and a quarterly business review tomorrow. How do you plan your week?',
          difficulty: 3,
          followUpHints: ['Triage criteria', 'What you delegate or defer'],
        },
      },
    ],
  },
];
