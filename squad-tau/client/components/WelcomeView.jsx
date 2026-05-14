import React from 'react';
import { Center, VStack, Heading, Text, Button, Icon } from '@chakra-ui/react';
import { Users, Settings } from 'lucide-react';

export default function WelcomeView({ onOpenModelPool }) {
  return (
    <Center h="full" p={8}>
      <VStack gap={8} maxW="md" textAlign="center">
        <VStack>
          <Icon as={Users} boxSize={12} color="blue.solid" />
          <Heading size="lg">
            Welcome to Squad-Tau
          </Heading>
          <Text color="fg.muted">
            Type /squad {'<task>'} in your terminal to start a multi-agent orchestrated task.
          </Text>
        </VStack>
        <Button
          colorPalette="blue"
          size="lg"
          onClick={onOpenModelPool}
        >
          <Icon as={Settings} boxSize={4} />
          Configure Model Pool
        </Button>
      </VStack>
    </Center>
  );
}
